// What to compare or preview, worked out from the places a command can be
// started from: a Source Control row, an editor or a diff editor tab, the
// Explorer or the Timeline. No VS Code API here, so it can be tested in Node.

import { glyphFileKind } from "../../src/formats/glyph-model.js";
import { kerningFileKind } from "../../src/formats/kerning.js";

export const WORKTREE = "WORKTREE";
export const INDEX = "INDEX";
export const EMPTY = "EMPTY";

// Group types of the resources the built-in git extension shows in the
// Source Control view (ResourceGroupType in extensions/git/src/repository.ts)
export const ResourceGroup = Object.freeze({
  merge: 0,
  index: 1,
  workingTree: 2,
  untracked: 3,
});

// "glyphs", "kerning", both, or neither, for a path with "/" separators
export function fileKinds(filePath) {
  const posixPath = toPosixPath(filePath);
  return {
    glyphs: glyphFileKind(posixPath) !== null,
    kerning: kerningFileKind(posixPath) !== null,
  };
}

export function isFontFile(filePath) {
  const kinds = fileKinds(filePath);
  return kinds.glyphs || kinds.kerning;
}

export function toPosixPath(filePath) {
  return filePath.replace(/\\/g, "/");
}

// Revision spec for one side of a git: URI made by the built-in git
// extension. Its query is JSON with the ref: "" is the index, "~" the index
// as the left side of a working tree diff, anything else a commit or ref.
export function revisionFromGitQuery(query) {
  let ref;
  try {
    ref = JSON.parse(query).ref;
  } catch (error) {
    return null;
  }
  if (typeof ref !== "string") {
    return null;
  }
  return ref === "" || ref === "~" ? INDEX : ref;
}

// The comparison for a file with uncommitted changes.
//   group: where the command came from (a ResourceGroup value, or undefined
//          for an editor, the Explorer or the Command Palette)
//   status: the repository status from Repository.status() of the bridge
// Returns { path, oldPath, from, to, status }.
export function changesRequest(filePath, group, status) {
  const staged = status.staged?.find((change) => change.path === filePath);
  const unstaged = status.unstaged?.find((change) => change.path === filePath);
  const untracked = status.untracked?.some((change) => change.path === filePath);
  const conflict = status.conflicts?.find((change) => change.path === filePath);
  const oldPath = staged?.origPath ?? null;
  const headOrEmpty = staged?.status === "A" || !status.hasCommits ? EMPTY : "HEAD";

  if (group === ResourceGroup.index) {
    // Same as VS Code: staged changes are HEAD → index
    return {
      path: filePath,
      oldPath,
      from: headOrEmpty,
      to: staged?.status === "D" ? EMPTY : INDEX,
      status: staged?.status ?? "M",
    };
  }
  if (untracked) {
    return { path: filePath, oldPath: null, from: EMPTY, to: WORKTREE, status: "?" };
  }
  if (group === ResourceGroup.workingTree || group === ResourceGroup.merge) {
    // Same as VS Code: unstaged changes are index → working tree
    return {
      path: filePath,
      oldPath: null,
      from: staged?.status === "D" ? EMPTY : INDEX,
      to: unstaged?.status === "D" ? EMPTY : WORKTREE,
      status: conflict ? "U" : (unstaged?.status ?? "M"),
    };
  }
  // From an editor or the Explorer: everything not committed yet
  const deleted = unstaged?.status === "D" || staged?.status === "D";
  return {
    path: filePath,
    oldPath,
    from: headOrEmpty,
    to: deleted ? EMPTY : WORKTREE,
    status: conflict ? "U" : (unstaged?.status ?? staged?.status ?? "M"),
  };
}

// `git log --format=<LOG_FORMAT> --name-status -M -- path` output → commits
// that changed the file: { hash, shortHash, parents, author, time, subject,
// status, path, oldPath }
export const LOG_FORMAT = "%x1e%H%x1f%h%x1f%P%x1f%an%x1f%at%x1f%s";

export function parseFileLog(output) {
  const commits = [];
  for (const record of output.split("\x1e")) {
    if (!record.trim()) {
      continue;
    }
    const newline = record.indexOf("\n");
    const header = newline < 0 ? record : record.slice(0, newline);
    const body = newline < 0 ? "" : record.slice(newline + 1);
    const [hash, shortHash, parents, author, time, subject] = header.split("\x1f");
    const line = body.split("\n").find((text) => /^[A-Z]\d*\t/.test(text));
    let status = "M";
    let path = null;
    let oldPath = null;
    if (line) {
      const fields = line.split("\t");
      status = fields[0][0];
      if ((status === "R" || status === "C") && fields.length >= 3) {
        oldPath = fields[1];
        path = fields[2];
      } else {
        path = fields[1] ?? null;
      }
    }
    commits.push({
      hash,
      shortHash,
      parents: parents ? parents.split(" ") : [],
      author,
      time: Number(time),
      subject: subject ?? "",
      status,
      path,
      oldPath,
    });
  }
  return commits;
}

// The comparison for one commit of a file's history: its first parent → it
export function commitRequest(commit, filePath) {
  const path = commit.path ?? filePath;
  return {
    path,
    oldPath: commit.oldPath,
    from: commit.status === "A" || !commit.parents.length ? EMPTY : commit.parents[0],
    to: commit.status === "D" ? EMPTY : commit.hash,
    status: commit.status,
  };
}

// True when a file the preview asked for may be read: the font package the
// previewed file is in, or the previewed file itself
export function isInsideFont(fontPath, requestedPath) {
  const font = toPosixPath(fontPath);
  const requested = toPosixPath(requestedPath);
  if (requested === font) {
    return true;
  }
  if (!requested.startsWith(`${font}/`)) {
    return false;
  }
  return !requested
    .slice(font.length + 1)
    .split("/")
    .some((segment) => segment === ".." || segment === "." || segment === "");
}
