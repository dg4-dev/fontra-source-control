// Parsers for git's machine-readable output. No I/O, so they can be tested
// without running git.

export const FIELD_SEPARATOR = "\x1f";
export const RECORD_SEPARATOR = "\x1e";

// `git status --porcelain=v2 --branch -z`
export function parseStatus(output) {
  const result = {
    branch: { oid: null, head: null, upstream: null, ahead: 0, behind: 0 },
    staged: [],
    unstaged: [],
    untracked: [],
    conflicts: [],
  };
  const fields = output.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (!entry) {
      continue;
    }
    if (entry.startsWith("# ")) {
      parseBranchHeader(entry.slice(2), result.branch);
      continue;
    }
    const kind = entry[0];
    if (kind === "1") {
      // 1 XY sub mH mI mW hH hI path
      const parts = splitFields(entry, 9);
      addChange(result, parts[1], parts[8], null);
    } else if (kind === "2") {
      // 2 XY sub mH mI mW hH hI Xscore path, then origPath as the next field
      const parts = splitFields(entry, 10);
      const origPath = fields[++i] ?? null;
      addChange(result, parts[1], parts[9], origPath);
    } else if (kind === "u") {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const parts = splitFields(entry, 11);
      result.conflicts.push({ path: parts[10], status: parts[1] });
    } else if (kind === "?") {
      result.untracked.push({ path: entry.slice(2), status: "?" });
    }
    // "!" (ignored) entries are not requested
  }
  return result;
}

function parseBranchHeader(header, branch) {
  const space = header.indexOf(" ");
  const key = header.slice(0, space);
  const value = header.slice(space + 1);
  switch (key) {
    case "branch.oid":
      branch.oid = value === "(initial)" ? null : value;
      break;
    case "branch.head":
      branch.head = value === "(detached)" ? null : value;
      break;
    case "branch.upstream":
      branch.upstream = value;
      break;
    case "branch.ab": {
      const match = value.match(/^\+(\d+) -(\d+)$/);
      if (match) {
        branch.ahead = Number(match[1]);
        branch.behind = Number(match[2]);
      }
      break;
    }
  }
}

function addChange(result, xy, path, origPath) {
  const [indexStatus, worktreeStatus] = xy;
  if (indexStatus !== ".") {
    const change = { path, status: indexStatus };
    if (origPath !== null) {
      change.origPath = origPath;
    }
    result.staged.push(change);
  }
  if (worktreeStatus !== ".") {
    result.unstaged.push({ path, status: worktreeStatus });
  }
}

// Splits on the first (count - 1) spaces; the last field (a path) may contain spaces
function splitFields(entry, count) {
  const parts = [];
  let start = 0;
  for (let n = 0; n < count - 1; n++) {
    const space = entry.indexOf(" ", start);
    if (space < 0) {
      break;
    }
    parts.push(entry.slice(start, space));
    start = space + 1;
  }
  parts.push(entry.slice(start));
  return parts;
}

export const LOG_FORMAT = ["%H", "%P", "%an", "%ae", "%at", "%cn", "%ce", "%ct", "%s"]
  .join("%x1f")
  .concat("%x1e");

// `git log --format=LOG_FORMAT`
export function parseLog(output) {
  const commits = [];
  for (const record of output.split(RECORD_SEPARATOR)) {
    const trimmed = record.replace(/^\n/, "");
    if (!trimmed) {
      continue;
    }
    const [
      hash,
      parents,
      authorName,
      authorEmail,
      authorTime,
      committerName,
      committerEmail,
      committerTime,
      subject,
    ] = trimmed.split(FIELD_SEPARATOR);
    commits.push({
      hash,
      parents: parents ? parents.split(" ") : [],
      authorName,
      authorEmail,
      authorTime: Number(authorTime),
      committerName,
      committerEmail,
      committerTime: Number(committerTime),
      subject: subject ?? "",
    });
  }
  return commits;
}

export const REF_FORMAT = [
  "%(objectname)",
  "%(*objectname)",
  "%(refname)",
  "%(upstream:short)",
  "%(upstream:track,nobracket)",
].join("%1f");

// `git for-each-ref --format=REF_FORMAT`
export function parseRefs(output) {
  const refs = [];
  for (const line of output.split("\n")) {
    if (!line) {
      continue;
    }
    const [objectName, peeledName, refName, upstream, track] =
      line.split(FIELD_SEPARATOR);
    const target = peeledName || objectName;
    let type;
    let name;
    if (refName.startsWith("refs/heads/")) {
      type = "head";
      name = refName.slice("refs/heads/".length);
    } else if (refName.startsWith("refs/remotes/")) {
      name = refName.slice("refs/remotes/".length);
      if (name.endsWith("/HEAD")) {
        continue;
      }
      type = "remote";
    } else if (refName.startsWith("refs/tags/")) {
      type = "tag";
      name = refName.slice("refs/tags/".length);
    } else {
      continue;
    }
    const ref = { type, name, hash: target };
    if (type === "head") {
      ref.upstream = upstream || null;
      ref.gone = track === "gone";
    }
    refs.push(ref);
  }
  return refs;
}

// `git diff --name-status -z` / `git diff-tree -r --name-status -z`
export function parseNameStatus(output) {
  const files = [];
  const fields = output.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i];
    if (!status) {
      continue;
    }
    const letter = status[0];
    if (letter === "R" || letter === "C") {
      const origPath = fields[++i];
      const path = fields[++i];
      files.push({ status: letter, path, origPath });
    } else {
      files.push({ status: letter, path: fields[++i] });
    }
  }
  return files;
}

export const STASH_FORMAT = ["%gd", "%H", "%at", "%gs"].join("%x1f");

// `git stash list --format=STASH_FORMAT`
export function parseStashList(output) {
  const stashes = [];
  for (const line of output.split("\n")) {
    if (!line) {
      continue;
    }
    const [ref, hash, time, subject] = line.split(FIELD_SEPARATOR);
    const match = ref.match(/^stash@\{(\d+)\}$/);
    stashes.push({
      index: match ? Number(match[1]) : stashes.length,
      hash,
      time: Number(time),
      subject: subject ?? "",
    });
  }
  return stashes;
}

// `git remote -v`
export function parseRemotes(output) {
  const remotes = new Map();
  for (const line of output.split("\n")) {
    const match = line.match(/^(\S+)\t(\S+) \((fetch|push)\)$/);
    if (!match) {
      continue;
    }
    const [, name, url, kind] = match;
    if (!remotes.has(name)) {
      remotes.set(name, { name, fetchUrl: null, pushUrl: null });
    }
    remotes.get(name)[kind === "fetch" ? "fetchUrl" : "pushUrl"] = url;
  }
  return [...remotes.values()];
}
