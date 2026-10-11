// Runs real git commands in a temporary repository
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runGit } from "../../bridge/git.js";
import { GitFiles } from "../src/git-files.mjs";
import { INDEX, WORKTREE } from "../src/requests.mjs";

Object.assign(process.env, {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
});

let folder;
let glifPath;

function glif(advance) {
  return `<?xml version="1.0"?>\n<glyph name="A" format="2">\n  <advance width="${advance}"/>\n</glyph>\n`;
}

before(async () => {
  folder = mkdtempSync(path.join(os.tmpdir(), "fontra-glyph-diff-test-"));
  mkdirSync(path.join(folder, "Font.ufo", "glyphs"), { recursive: true });
  glifPath = path.join(folder, "Font.ufo", "glyphs", "A_.glif");
  writeFileSync(glifPath, glif(500));
  await runGit(["init", "-q", "-b", "main"], { cwd: folder });
  await runGit(["add", "-A"], { cwd: folder });
  await runGit(["commit", "-q", "-m", "First"], { cwd: folder });
  writeFileSync(glifPath, glif(600));
  await runGit(["commit", "-q", "-am", "Wider A"], { cwd: folder });
  writeFileSync(glifPath, glif(700));
});

after(() => {
  rmSync(folder, { recursive: true, force: true });
});

test("finds the repository and the file's path in it", async () => {
  const { files, path: filePath } = await GitFiles.forFile(glifPath);
  assert.equal(filePath, "Font.ufo/glyphs/A_.glif");
  assert.match(await files.readText("HEAD", filePath), /width="600"/);
  assert.match(await files.readText(INDEX, filePath), /width="600"/);
  assert.match(await files.readText(WORKTREE, filePath), /width="700"/);
  assert.equal(await files.readText("HEAD", "Font.ufo/glyphs/B_.glif"), null);
});

test("unsaved editor text counts as the working tree", async () => {
  const { files, path: filePath } = await GitFiles.forFile(glifPath, (absolute) =>
    path.resolve(absolute) === path.resolve(glifPath) ? glif(800) : null
  );
  assert.match(await files.readText(WORKTREE, filePath), /width="800"/);
  const diff = await files.diff({ path: filePath, from: "HEAD", to: WORKTREE });
  assert.match(diff.patch, /-  <advance width="600"\/>/);
  assert.match(diff.patch, /\+  <advance width="800"\/>/);
});

test("file history", async () => {
  const { files, path: filePath } = await GitFiles.forFile(glifPath);
  const commits = await files.fileLog(filePath);
  assert.deepEqual(
    commits.map((commit) => [commit.subject, commit.status]),
    [
      ["Wider A", "M"],
      ["First", "A"],
    ]
  );
  assert.equal(commits[0].parents[0], commits[1].hash);
});

test("files outside a repository", async () => {
  const outside = mkdtempSync(path.join(os.tmpdir(), "fontra-glyph-diff-norepo-"));
  try {
    await assert.rejects(
      GitFiles.forFile(path.join(outside, "A.glif")),
      /not-a-repository/
    );
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
