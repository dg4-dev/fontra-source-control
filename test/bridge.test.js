// Bridge tests run real git commands in temporary repositories.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runGit } from "../bridge/git.js";
import {
  parseLog,
  parseNameStatus,
  parseRefs,
  parseRemotes,
  parseStashList,
  parseStatus,
} from "../bridge/parse.js";
import {
  ProjectError,
  isInside,
  resolveProject,
  resolveRoot,
} from "../bridge/project.js";
import { Repository, RequestError } from "../bridge/repository.js";
import {
  createBridgeServer,
  isLocalHostHeader,
  isLocalOrigin,
} from "../bridge/server.js";

const identity = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};
Object.assign(process.env, identity);

let tempRoot;

before(() => {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), "fontra-sc-test-"));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function makeFolder(name) {
  const folder = path.join(tempRoot, name);
  mkdirSync(path.join(folder, "Font.ufo", "glyphs"), { recursive: true });
  writeFileSync(path.join(folder, "Font.ufo", "glyphs", "A_.glif"), glif(740));
  writeFileSync(path.join(folder, "Font.ufo", "fontinfo.plist"), "<plist/>\n");
  return folder;
}

function glif(advance, y = 0) {
  return `<?xml version="1.0"?>\n<glyph name="A" format="2">\n  <advance width="${advance}"/>\n  <outline>\n    <contour>\n      <point x="0" y="${y}" type="line"/>\n      <point x="100" y="700" type="line"/>\n    </contour>\n  </outline>\n</glyph>\n`;
}

async function initRepository(name) {
  const folder = makeFolder(name);
  const repo = await Repository.open(folder);
  await repo.init({ initialBranch: "main" });
  return { folder, repo };
}

// --- parsers -------------------------------------------------------------------

test("status parser", () => {
  const output = [
    "# branch.oid 1234567890abcdef",
    "# branch.head main",
    "# branch.upstream origin/main",
    "# branch.ab +2 -1",
    "1 M. N... 100644 100644 100644 aaa bbb a b.txt",
    "1 .M N... 100644 100644 100644 aaa bbb Font.ufo/glyphs/A_.glif",
    "1 MM N... 100644 100644 100644 aaa bbb both.txt",
    "2 R. N... 100644 100644 100644 aaa bbb R100 new name.txt",
    "old name.txt",
    "u UU N... 100644 100644 100644 100644 a b c conflict.txt",
    "? new file.txt",
    "",
  ].join("\0");
  const status = parseStatus(output);
  assert.deepEqual(status.branch, {
    oid: "1234567890abcdef",
    head: "main",
    upstream: "origin/main",
    ahead: 2,
    behind: 1,
  });
  assert.deepEqual(status.staged, [
    { path: "a b.txt", status: "M" },
    { path: "both.txt", status: "M" },
    { path: "new name.txt", status: "R", origPath: "old name.txt" },
  ]);
  assert.deepEqual(status.unstaged, [
    { path: "Font.ufo/glyphs/A_.glif", status: "M" },
    { path: "both.txt", status: "M" },
  ]);
  assert.deepEqual(status.conflicts, [{ path: "conflict.txt", status: "UU" }]);
  assert.deepEqual(status.untracked, [{ path: "new file.txt", status: "?" }]);
  const initial = parseStatus("# branch.oid (initial)\0# branch.head (detached)\0");
  assert.equal(initial.branch.oid, null);
  assert.equal(initial.branch.head, null);
});

test("log, refs, name-status, stash and remote parsers", () => {
  const log = parseLog(
    ["h1", "p1 p2", "A", "a@x", "100", "C", "c@x", "200", "Merge"].join("\x1f") +
      "\x1e\n" +
      ["p1", "", "A", "a@x", "50", "C", "c@x", "60", "Root"].join("\x1f") +
      "\x1e"
  );
  assert.deepEqual(log[0].parents, ["p1", "p2"]);
  assert.equal(log[0].authorTime, 100);
  assert.deepEqual(log[1].parents, []);

  const refs = parseRefs(
    [
      ["h1", "", "refs/heads/main", "origin/main", ""],
      ["h2", "", "refs/remotes/origin/HEAD", "", ""],
      ["h3", "", "refs/remotes/origin/main", "", ""],
      ["tagobj", "h1", "refs/tags/v1", "", ""],
      ["h4", "", "refs/stash", "", ""],
    ]
      .map((fields) => fields.join("\x1f"))
      .join("\n")
  );
  assert.deepEqual(refs, [
    { type: "head", name: "main", hash: "h1", upstream: "origin/main", gone: false },
    { type: "remote", name: "origin/main", hash: "h3" },
    { type: "tag", name: "v1", hash: "h1" },
  ]);

  assert.deepEqual(parseNameStatus("M\0a.txt\0R090\0old.txt\0new.txt\0D\0gone.txt\0"), [
    { status: "M", path: "a.txt" },
    { status: "R", path: "new.txt", origPath: "old.txt" },
    { status: "D", path: "gone.txt" },
  ]);
  assert.deepEqual(parseStashList("stash@{0}\x1fabc\x1f10\x1fOn main: wip\n"), [
    { index: 0, hash: "abc", time: 10, subject: "On main: wip" },
  ]);
  assert.deepEqual(
    parseRemotes("origin\thttps://x/y.git (fetch)\norigin\tgit@x:y.git (push)\n"),
    [{ name: "origin", fetchUrl: "https://x/y.git", pushUrl: "git@x:y.git" }]
  );
});

// --- projects --------------------------------------------------------------------

test("project identifiers resolve like Fontra's filesystem project manager", () => {
  const folder = makeFolder("projects");
  const root = resolveRoot(folder);
  assert.equal(root, folder);
  assert.equal(resolveRoot(path.join(folder, "Font.ufo")), folder);
  assert.equal(resolveRoot("-"), null);
  assert.deepEqual(resolveProject(root, "Font.ufo"), {
    projectPath: path.join(folder, "Font.ufo"),
    workDir: folder,
  });
  // Absolute mode: Fontra drops the leading slash
  assert.equal(
    resolveProject(null, path.join(folder, "Font.ufo").slice(1)).workDir,
    folder
  );
  assert.throws(() => resolveProject(root, "../x.ufo"), ProjectError);
  assert.throws(() => resolveProject(root, "Missing.ufo"), ProjectError);
  assert.ok(isInside("/a/b", "/a/b/c"));
  assert.ok(!isInside("/a/b", "/a/bc"));
  assert.ok(!isInside("/a/b", "/a"));
});

// --- repository operations ----------------------------------------------------------

test("init, stage, commit, diff and history", async () => {
  const { folder, repo } = await initRepository("basic");
  let status = await repo.status();
  assert.equal(status.initialized, true);
  assert.equal(status.hasCommits, false);
  assert.equal(status.branch.head, "main");
  assert.deepEqual(status.untracked.map((c) => c.path).sort(), [
    "Font.ufo/fontinfo.plist",
    "Font.ufo/glyphs/A_.glif",
  ]);

  await repo.stage({ paths: ["Font.ufo/glyphs/A_.glif"] });
  await repo.unstage({ paths: ["Font.ufo/glyphs/A_.glif"] }); // before the first commit
  await assert.rejects(repo.commit({ message: "  " }), RequestError);
  await repo.stageAll();
  const first = await repo.commit({ message: "First\n\nBody text" });
  assert.match(first.hash, /^[0-9a-f]{40}$/);

  writeFileSync(path.join(folder, "Font.ufo/glyphs/A_.glif"), glif(760, 10));
  status = await repo.status();
  assert.deepEqual(status.unstaged, [{ path: "Font.ufo/glyphs/A_.glif", status: "M" }]);

  const diff = await repo.diff({
    from: "INDEX",
    to: "WORKTREE",
    path: "Font.ufo/glyphs/A_.glif",
    contents: true,
  });
  assert.match(diff.patch, /-  <advance width="740"\/>/);
  assert.match(diff.patch, /\+  <advance width="760"\/>/);
  assert.match(diff.new.text, /760/);
  assert.match(diff.old.text, /740/);

  const added = await repo.diff({
    from: "EMPTY",
    to: "HEAD",
    path: "Font.ufo/fontinfo.plist",
  });
  assert.equal(added.old.exists, false);
  assert.match(added.patch, /\+<plist\/>/);

  await repo.commit({ message: "Second", all: true });
  const log = await repo.log();
  assert.deepEqual(
    log.commits.map((c) => c.subject),
    ["Second", "First"]
  );
  const details = await repo.commitDetails({ hash: log.commits[0].hash });
  assert.deepEqual(details.files, [
    {
      status: "M",
      path: "Font.ufo/glyphs/A_.glif",
      from: log.commits[1].hash,
      to: log.commits[0].hash,
    },
  ]);
  const root = await repo.commitDetails({ hash: log.commits[1].hash });
  assert.equal(root.message, "First\n\nBody text");
  assert.equal(root.files.length, 2);
  assert.equal(root.files[0].from, "EMPTY");

  const file = await repo.readFile({
    rev: log.commits[1].hash,
    path: "Font.ufo/glyphs/A_.glif",
  });
  assert.match(file.text, /740/);
  assert.equal(
    (await repo.readFile({ rev: "HEAD", path: "missing.txt" })).exists,
    false
  );

  await repo.commit({ message: "", amend: true });
  assert.equal((await repo.log()).commits[0].subject, "Second");
});

test("discard restores tracked files and deletes untracked ones", async () => {
  const { folder, repo } = await initRepository("discard");
  await repo.commit({ message: "Init", all: true });
  const glyphPath = path.join(folder, "Font.ufo/glyphs/A_.glif");
  writeFileSync(glyphPath, glif(1));
  writeFileSync(path.join(folder, "new.txt"), "x");
  await repo.discard({ paths: ["Font.ufo/glyphs/A_.glif", "new.txt"] });
  assert.equal(readFileSync(glyphPath, "utf8"), glif(740));
  const status = await repo.status();
  assert.equal(status.unstaged.length + status.untracked.length, 0);
});

test("branches, merge conflicts, abort, stash and tags", async () => {
  const { folder, repo } = await initRepository("branches");
  await repo.commit({ message: "Init", all: true });
  const glyphPath = path.join(folder, "Font.ufo/glyphs/A_.glif");

  await repo.createBranch({ name: "feature/wide" });
  writeFileSync(glyphPath, glif(800));
  await repo.commit({ message: "Wide", all: true });
  await repo.checkout({ ref: "main" });
  writeFileSync(glyphPath, glif(700));
  await repo.commit({ message: "Narrow", all: true });

  const refs = await repo.refs();
  assert.equal(refs.currentBranch, "main");
  assert.deepEqual(
    refs.refs
      .filter((r) => r.type === "head")
      .map((r) => r.name)
      .sort(),
    ["feature/wide", "main"]
  );

  const merge = await repo.merge({ ref: "feature/wide" });
  assert.equal(merge.conflicts, true);
  let status = await repo.status();
  assert.equal(status.operation, "merge");
  assert.deepEqual(status.conflicts, [
    { path: "Font.ufo/glyphs/A_.glif", status: "UU" },
  ]);
  await repo.abortOperation();
  status = await repo.status();
  assert.equal(status.operation, null);

  // Resolve a conflict and continue
  await repo.merge({ ref: "feature/wide" });
  writeFileSync(glyphPath, glif(750));
  await repo.stage({ paths: ["Font.ufo/glyphs/A_.glif"] });
  await repo.continueOperation();
  const log = await repo.log();
  assert.equal(log.commits[0].parents.length, 2);

  writeFileSync(glyphPath, glif(1));
  writeFileSync(path.join(folder, "scratch.txt"), "x");
  await repo.stash({ message: "try", includeUntracked: true });
  status = await repo.status();
  assert.equal(status.stashCount, 1);
  assert.equal(status.unstaged.length + status.untracked.length, 0);
  const stashes = await repo.stashList();
  assert.equal(stashes[0].subject, "On main: try");
  const stashDetails = await repo.stashDetails({ index: 0 });
  assert.deepEqual(stashDetails.files.map((f) => [f.status, f.path]).sort(), [
    ["?", "scratch.txt"],
    ["M", "Font.ufo/glyphs/A_.glif"],
  ]);
  await repo.stashApply({ index: 0, pop: true });
  assert.equal((await repo.status()).stashCount, 0);
  assert.equal(readFileSync(glyphPath, "utf8"), glif(1));
  await repo.discard({ paths: ["Font.ufo/glyphs/A_.glif", "scratch.txt"] });

  await repo.createTag({ name: "v1", ref: "HEAD", message: "Release" });
  const tags = (await repo.refs()).refs.filter((r) => r.type === "tag");
  assert.equal(tags[0].hash, log.commits[0].hash);

  await repo.renameBranch({ name: "feature/wide", newName: "feature/wider" });
  await repo.deleteBranch({ name: "feature/wider" });
  await repo.checkout({ ref: log.commits[1].hash, kind: "commit" });
  assert.equal((await repo.status()).branch.head, null);
  await repo.checkout({ ref: "main" });

  await repo.revert({ hash: log.commits[0].hash });
  assert.match((await repo.log()).commits[0].subject, /^Revert/);
  await repo.reset({ hash: log.commits[0].hash, mode: "hard" });
  assert.equal((await repo.log()).commits[0].hash, log.commits[0].hash);
});

test("push, fetch and pull with a local remote", async () => {
  const { folder, repo } = await initRepository("remote");
  await repo.commit({ message: "Init", all: true });
  const bare = path.join(tempRoot, "remote.git");
  await runGit(["init", "--bare", "--initial-branch=main", bare]);
  await assert.rejects(repo.push(), /No remote/);
  await repo.addRemote({ name: "origin", url: bare });
  await repo.push();
  let status = await repo.status();
  assert.equal(status.branch.upstream, "origin/main");
  assert.deepEqual(status.remotes, ["origin"]);

  // A second clone pushes a commit; the first one pulls it
  const clone = path.join(tempRoot, "clone");
  await runGit(["clone", "--quiet", bare, clone]);
  writeFileSync(
    path.join(clone, "Font.ufo/fontinfo.plist"),
    "<plist>changed</plist>\n"
  );
  await runGit(["commit", "--quiet", "-am", "Remote change"], { cwd: clone });
  await runGit(["push", "--quiet"], { cwd: clone });
  await repo.fetch();
  status = await repo.status();
  assert.equal(status.branch.behind, 1);
  const pulled = await repo.pull({ mode: "ff-only" });
  assert.equal(pulled.conflicts, false);
  assert.equal(
    readFileSync(path.join(folder, "Font.ufo/fontinfo.plist"), "utf8"),
    "<plist>changed</plist>\n"
  );
});

test("unsafe input is rejected", async () => {
  const { repo } = await initRepository("validation");
  await repo.commit({ message: "Init", all: true });
  await assert.rejects(repo.stage({ paths: ["../outside"] }), RequestError);
  await assert.rejects(repo.stage({ paths: ["/etc/passwd"] }), RequestError);
  await assert.rejects(repo.stage({ paths: [] }), RequestError);
  await assert.rejects(repo.checkout({ ref: "--orphan" }), RequestError);
  await assert.rejects(repo.merge({ ref: "a..b" }), RequestError);
  await assert.rejects(repo.createBranch({ name: "bad name" }), RequestError);
  await assert.rejects(repo.createBranch({ name: "-x" }), RequestError);
  await assert.rejects(repo.reset({ hash: "HEAD", mode: "keep" }), RequestError);
  await assert.rejects(repo.stashDrop({ index: -1 }), RequestError);
  await assert.rejects(
    repo.addRemote({ name: "x", url: "--upload-pack=evil" }),
    RequestError
  );
  await assert.rejects(
    repo.readFile({ rev: "WORKTREE", path: "a/../../x" }),
    RequestError
  );
  // Pathspec magic is taken literally
  await repo.stage({ paths: [":(glob)*"] }).catch(() => {});
  assert.equal((await repo.status()).staged.length, 0);
});

test("a folder that is not a repository", async () => {
  const folder = makeFolder("plain");
  const repo = await Repository.open(folder);
  // The temp folder must not be inside another repository for this test
  if (repo.initialized) {
    return;
  }
  const status = await repo.status();
  assert.deepEqual(status, { initialized: false, workDir: folder });
  await assert.rejects(repo.log(), RequestError);
});

// --- HTTP server ----------------------------------------------------------------------

test("origin and host checks", () => {
  assert.ok(isLocalOrigin("http://localhost:8000"));
  assert.ok(isLocalOrigin("http://127.0.0.1:8000"));
  assert.ok(isLocalOrigin("http://[::1]:8000"));
  assert.ok(!isLocalOrigin("https://example.com"));
  assert.ok(!isLocalOrigin("http://localhost.example.com"));
  assert.ok(!isLocalOrigin("null"));
  assert.ok(isLocalHostHeader("localhost:8765"));
  assert.ok(isLocalHostHeader("[::1]:8765"));
  assert.ok(!isLocalHostHeader("evil.example:8765"));
  assert.ok(!isLocalHostHeader(undefined));
});

test("HTTP API", async () => {
  const folder = makeFolder("server");
  const server = createBridgeServer({
    root: folder,
    allowedOrigins: ["https://fontra.example"],
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const call = (command, body, headers = {}) =>
    fetch(`http://localhost:${port}/api/${command}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "http://localhost:8000",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  try {
    let response = await call("status", { project: "Font.ufo" });
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "http://localhost:8000"
    );
    const data = await response.json();
    assert.equal(data.ok, true);

    response = await call("init", { project: "Font.ufo" });
    assert.equal((await response.json()).ok, true);

    response = await call(
      "status",
      { project: "Font.ufo" },
      { Origin: "https://evil.example" }
    );
    assert.equal(response.status, 403);
    response = await call(
      "status",
      { project: "Font.ufo" },
      { Origin: "https://fontra.example" }
    );
    assert.equal(response.status, 200);

    response = await call("nope", { project: "Font.ufo" });
    assert.equal(response.status, 404);
    response = await call("status", { project: "../etc" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).ok, false);

    response = await fetch(`http://localhost:${port}/api/status`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    });
    assert.equal(response.status, 415);

    response = await fetch(`http://localhost:${port}/api/status`, {
      method: "OPTIONS",
      headers: {
        "Origin": "http://localhost:8000",
        "Access-Control-Request-Method": "POST",
      },
    });
    assert.equal(response.status, 204);
    assert.match(response.headers.get("access-control-allow-headers"), /Content-Type/);

    response = await fetch(`http://localhost:${port}/`);
    assert.equal((await response.json()).result.name, "fontra-git-bridge");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
