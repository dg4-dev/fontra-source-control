import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMPTY,
  INDEX,
  ResourceGroup,
  WORKTREE,
  changesRequest,
  commitRequest,
  fileKinds,
  isFontFile,
  isInsideFont,
  parseFileLog,
  revisionFromGitQuery,
} from "../src/requests.mjs";

test("file kinds", () => {
  assert.deepEqual(fileKinds("Font.ufo/glyphs/A_.glif"), {
    glyphs: true,
    kerning: false,
  });
  assert.deepEqual(fileKinds("C:\\Fonts\\Font.ufo\\kerning.plist"), {
    glyphs: false,
    kerning: true,
  });
  assert.deepEqual(fileKinds("/f/Font.glyphs"), { glyphs: true, kerning: true });
  assert.equal(isFontFile("/f/Font.fontra/glyphs/A^1.json"), true);
  assert.equal(isFontFile("/f/Font.fontra/font-data.json"), false);
  assert.equal(isFontFile("/f/Font.glyphspackage/fontinfo.plist"), true);
  assert.equal(isFontFile("/f/README.md"), false);
});

test("git URI revisions", () => {
  assert.equal(revisionFromGitQuery(JSON.stringify({ path: "/a", ref: "" })), INDEX);
  assert.equal(revisionFromGitQuery(JSON.stringify({ path: "/a", ref: "~" })), INDEX);
  assert.equal(
    revisionFromGitQuery(JSON.stringify({ path: "/a", ref: "HEAD" })),
    "HEAD"
  );
  assert.equal(revisionFromGitQuery("not json"), null);
  assert.equal(revisionFromGitQuery(JSON.stringify({ path: "/a" })), null);
});

const status = {
  hasCommits: true,
  staged: [
    { path: "F.ufo/glyphs/A_.glif", status: "M" },
    { path: "F.ufo/glyphs/B_.glif", status: "R", origPath: "F.ufo/glyphs/C_.glif" },
    { path: "F.ufo/glyphs/N.glif", status: "A" },
  ],
  unstaged: [
    { path: "F.ufo/glyphs/A_.glif", status: "M" },
    { path: "F.ufo/glyphs/D_.glif", status: "D" },
  ],
  untracked: [{ path: "F.ufo/glyphs/U_.glif", status: "?" }],
  conflicts: [],
};

test("changes from Source Control groups", () => {
  assert.deepEqual(
    changesRequest("F.ufo/glyphs/A_.glif", ResourceGroup.index, status),
    {
      path: "F.ufo/glyphs/A_.glif",
      oldPath: null,
      from: "HEAD",
      to: INDEX,
      status: "M",
    }
  );
  assert.deepEqual(
    changesRequest("F.ufo/glyphs/A_.glif", ResourceGroup.workingTree, status),
    {
      path: "F.ufo/glyphs/A_.glif",
      oldPath: null,
      from: INDEX,
      to: WORKTREE,
      status: "M",
    }
  );
  const renamed = changesRequest("F.ufo/glyphs/B_.glif", ResourceGroup.index, status);
  assert.equal(renamed.oldPath, "F.ufo/glyphs/C_.glif");
  assert.equal(renamed.status, "R");
  const added = changesRequest("F.ufo/glyphs/N.glif", ResourceGroup.index, status);
  assert.equal(added.from, EMPTY);
  const deleted = changesRequest(
    "F.ufo/glyphs/D_.glif",
    ResourceGroup.workingTree,
    status
  );
  assert.equal(deleted.to, EMPTY);
  const untracked = changesRequest(
    "F.ufo/glyphs/U_.glif",
    ResourceGroup.untracked,
    status
  );
  assert.deepEqual(
    [untracked.from, untracked.to, untracked.status],
    [EMPTY, WORKTREE, "?"]
  );
});

test("changes from an editor are everything not committed", () => {
  const request = changesRequest("F.ufo/glyphs/A_.glif", undefined, status);
  assert.deepEqual([request.from, request.to], ["HEAD", WORKTREE]);
  const renamed = changesRequest("F.ufo/glyphs/B_.glif", undefined, status);
  assert.equal(renamed.oldPath, "F.ufo/glyphs/C_.glif");
  const unchanged = changesRequest("F.ufo/glyphs/Z_.glif", undefined, status);
  assert.deepEqual([unchanged.from, unchanged.to], ["HEAD", WORKTREE]);
  const noCommits = changesRequest("F.ufo/glyphs/A_.glif", undefined, {
    ...status,
    hasCommits: false,
  });
  assert.equal(noCommits.from, EMPTY);
});

test("file history", () => {
  const output =
    "\x1eaaa1\x1faaa\x1fbbb1\x1fAna\x1f1700000000\x1fMove A\n\nR087\tF.ufo/glyphs/A_.glif\tF.ufo/glyphs/A_alt.glif\n" +
    "\x1ebbb1\x1fbbb\x1f\x1fAna\x1f1690000000\x1fFirst\n\nA\tF.ufo/glyphs/A_.glif\n";
  const commits = parseFileLog(output);
  assert.equal(commits.length, 2);
  assert.deepEqual(
    [commits[0].status, commits[0].oldPath, commits[0].path],
    ["R", "F.ufo/glyphs/A_.glif", "F.ufo/glyphs/A_alt.glif"]
  );
  assert.equal(commits[0].subject, "Move A");
  assert.deepEqual(commitRequest(commits[0], "F.ufo/glyphs/A_alt.glif"), {
    path: "F.ufo/glyphs/A_alt.glif",
    oldPath: "F.ufo/glyphs/A_.glif",
    from: "bbb1",
    to: "aaa1",
    status: "R",
  });
  assert.equal(commitRequest(commits[1], "F.ufo/glyphs/A_.glif").from, EMPTY);
});

test("preview reads only files of the same font", () => {
  const font = "/home/me/Font.ufo";
  assert.equal(isInsideFont(font, "/home/me/Font.ufo/glyphs/B_.glif"), true);
  assert.equal(isInsideFont(font, "/home/me/Font.ufo"), true);
  assert.equal(isInsideFont(font, "/home/me/Font.ufo/../secret"), false);
  assert.equal(isInsideFont(font, "/home/me/Font.ufox/a"), false);
  assert.equal(isInsideFont(font, "/home/me/Other.ufo/glyphs/B_.glif"), false);
  assert.equal(isInsideFont("C:\\Fonts\\F.ufo", "C:/Fonts/F.ufo/kerning.plist"), true);
});
