// Git operations on the repository that contains a Fontra project. Every value
// that comes from the plugin is validated before it reaches git's command line.

import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GitError, NETWORK_TIMEOUT_MS, runGit } from "./git.js";
import {
  LOG_FORMAT,
  REF_FORMAT,
  STASH_FORMAT,
  parseLog,
  parseNameStatus,
  parseRefs,
  parseRemotes,
  parseStashList,
  parseStatus,
} from "./parse.js";
import { isInside } from "./project.js";

export class RequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "RequestError";
  }
}

// Revision specs the plugin can ask file contents for, besides commit hashes
// and ref names
export const WORKTREE = "WORKTREE";
export const INDEX = "INDEX";
export const EMPTY = "EMPTY";

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8000;

// Commands that change the repository run one at a time per repository
const repositoryQueues = new Map();

function enqueue(key, task) {
  const previous = repositoryQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  repositoryQueues.set(key, next);
  next
    .finally(() => {
      if (repositoryQueues.get(key) === next) {
        repositoryQueues.delete(key);
      }
    })
    .catch(() => {});
  return next;
}

export class Repository {
  // workDir: the folder containing the font. root: the repository's top
  // level folder, or null when workDir is not inside a repository.
  constructor(workDir, root) {
    this.workDir = workDir;
    this.root = root;
  }

  static async open(workDir) {
    let root = null;
    try {
      const { stdout } = await runGit(["rev-parse", "--show-toplevel"], {
        cwd: workDir,
      });
      root = stdout.trim() || null;
    } catch (error) {
      if (!(error instanceof GitError) || error.code === null) {
        throw error;
      }
      // Exit code 128: not a git repository
    }
    return new Repository(workDir, root);
  }

  get initialized() {
    return this.root !== null;
  }

  requireRepository() {
    if (!this.initialized) {
      throw new RequestError("This folder is not a git repository yet.");
    }
  }

  git(args, options = {}) {
    return runGit(args, {
      cwd: this.root ?? this.workDir,
      ...options,
      env: { GIT_LITERAL_PATHSPECS: "1", ...options.env },
    });
  }

  // Runs a command that changes the repository, one at a time
  mutate(args, options = {}) {
    this.requireRepository();
    return enqueue(this.root, () => this.git(args, options));
  }

  async init({ initialBranch = "main" } = {}) {
    if (this.initialized) {
      throw new RequestError("This folder is already in a git repository.");
    }
    const args = ["init"];
    if (initialBranch) {
      await this.validateBranchName(initialBranch);
      args.push(`--initial-branch=${initialBranch}`);
    }
    await runGit(args, { cwd: this.workDir });
    const { stdout } = await runGit(["rev-parse", "--show-toplevel"], {
      cwd: this.workDir,
    });
    this.root = stdout.trim();
    return { root: this.root };
  }

  async hasCommits() {
    const { code } = await this.git(["rev-parse", "--verify", "--quiet", "HEAD"], {
      okCodes: [0, 1, 128],
    });
    return code === 0;
  }

  async gitDir() {
    const { stdout } = await this.git(["rev-parse", "--absolute-git-dir"]);
    return stdout.trim();
  }

  async currentOperation() {
    const gitDir = await this.gitDir();
    const has = (name) => existsSync(path.join(gitDir, name));
    if (has("rebase-merge") || has("rebase-apply")) {
      return "rebase";
    }
    if (has("MERGE_HEAD")) {
      return "merge";
    }
    if (has("CHERRY_PICK_HEAD")) {
      return "cherry-pick";
    }
    if (has("REVERT_HEAD")) {
      return "revert";
    }
    return null;
  }

  async status() {
    if (!this.initialized) {
      return { initialized: false, workDir: this.workDir };
    }
    const [statusOutput, operation, stashes, remotes, hasCommits] = await Promise.all([
      this.git(
        ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"],
        { env: { GIT_OPTIONAL_LOCKS: "0" } }
      ),
      this.currentOperation(),
      this.stashList(),
      this.remotes(),
      this.hasCommits(),
    ]);
    return {
      initialized: true,
      root: this.root,
      workDir: this.workDir,
      ...parseStatus(statusOutput.stdout),
      operation,
      hasCommits,
      stashCount: stashes.length,
      remotes: remotes.map((remote) => remote.name),
    };
  }

  // --- staging -------------------------------------------------------------

  async stage({ paths }) {
    const checked = this.validatePaths(paths);
    await this.mutate(["add", "--all", "--", ...checked]);
  }

  async stageAll() {
    await this.mutate(["add", "--all"]);
  }

  async unstage({ paths }) {
    const checked = this.validatePaths(paths);
    if (await this.hasCommits()) {
      await this.mutate(["reset", "--quiet", "HEAD", "--", ...checked]);
    } else {
      await this.mutate(["rm", "--cached", "-r", "--quiet", "--", ...checked]);
    }
  }

  async unstageAll() {
    if (await this.hasCommits()) {
      await this.mutate(["reset", "--quiet"]);
    } else {
      await this.mutate(["rm", "--cached", "-r", "--quiet", "--", "."]);
    }
  }

  // Discards working tree changes: tracked files go back to their staged (or
  // committed) state, untracked files are deleted.
  async discard({ paths }) {
    const checked = this.validatePaths(paths);
    const status = parseStatus(
      (await this.git(["status", "--porcelain=v2", "-z", "--untracked-files=all"]))
        .stdout
    );
    const untracked = new Set(status.untracked.map((change) => change.path));
    const toClean = checked.filter((p) => untracked.has(p));
    const toRestore = checked.filter((p) => !untracked.has(p));
    if (toClean.length) {
      await this.mutate(["clean", "--force", "--quiet", "--", ...toClean]);
    }
    if (toRestore.length) {
      await this.mutate(["checkout", "--", ...toRestore]);
    }
  }

  async commit({ message = "", amend = false, all = false } = {}) {
    if (typeof message !== "string") {
      throw new RequestError("invalid commit message");
    }
    if (!message.trim() && !amend) {
      throw new RequestError("Enter a commit message.");
    }
    if (all) {
      await this.mutate(["add", "--all"]);
    }
    const args = ["commit", "--quiet", "--cleanup=strip"];
    if (amend) {
      args.push("--amend");
    }
    if (message.trim()) {
      args.push("--file=-");
    } else {
      args.push("--no-edit");
    }
    await this.mutate(args, { input: message });
    const { stdout } = await this.git(["rev-parse", "HEAD"]);
    return { hash: stdout.trim() };
  }

  // --- branches and refs ---------------------------------------------------

  async refs() {
    this.requireRepository();
    const [refsOutput, headOutput, symbolicOutput] = await Promise.all([
      this.git(["for-each-ref", `--format=${REF_FORMAT}`]),
      this.git(["rev-parse", "--verify", "--quiet", "HEAD"], { okCodes: [0, 1, 128] }),
      this.git(["symbolic-ref", "--quiet", "--short", "HEAD"], { okCodes: [0, 1] }),
    ]);
    return {
      refs: parseRefs(refsOutput.stdout),
      head: headOutput.code === 0 ? headOutput.stdout.trim() : null,
      currentBranch: symbolicOutput.code === 0 ? symbolicOutput.stdout.trim() : null,
    };
  }

  async checkout({ ref, kind = "branch" }) {
    this.validateRev(ref);
    if (kind === "branch") {
      await this.mutate(["switch", "--no-guess", ref]);
    } else if (kind === "remote") {
      const localName = ref.slice(ref.indexOf("/") + 1);
      const exists = await this.git(
        ["show-ref", "--verify", "--quiet", `refs/heads/${localName}`],
        { okCodes: [0, 1] }
      );
      if (exists.code === 0) {
        await this.mutate(["switch", "--no-guess", localName]);
      } else {
        await this.validateBranchName(localName);
        await this.mutate(["switch", "--create", localName, "--track", ref]);
      }
    } else {
      await this.mutate(["switch", "--detach", ref]);
    }
  }

  async createBranch({ name, startPoint = null, checkout = true }) {
    await this.validateBranchName(name);
    const args = checkout ? ["switch", "--create", name] : ["branch", name];
    if (startPoint) {
      this.validateRev(startPoint);
      args.push(startPoint);
    }
    await this.mutate(args);
  }

  async deleteBranch({ name, force = false }) {
    this.validateRev(name);
    await this.mutate(["branch", force ? "-D" : "-d", name]);
  }

  async renameBranch({ name, newName }) {
    this.validateRev(name);
    await this.validateBranchName(newName);
    await this.mutate(["branch", "-m", name, newName]);
  }

  async deleteRemoteBranch({ name }) {
    this.validateRev(name);
    const slash = name.indexOf("/");
    if (slash <= 0) {
      throw new RequestError(`not a remote branch: ${name}`);
    }
    const remote = name.slice(0, slash);
    await this.validateRemote(remote);
    await this.mutate(["push", remote, "--delete", name.slice(slash + 1)], {
      timeout: NETWORK_TIMEOUT_MS,
    });
  }

  async createTag({ name, ref = "HEAD", message = "" }) {
    this.validateRev(ref);
    if (!name || name.startsWith("-")) {
      throw new RequestError("invalid tag name");
    }
    await this.validateRefFormat(`refs/tags/${name}`);
    if (message.trim()) {
      await this.mutate(["tag", "--annotate", "--file=-", name, ref], {
        input: message,
      });
    } else {
      await this.mutate(["tag", name, ref]);
    }
  }

  async deleteTag({ name }) {
    this.validateRev(name);
    await this.mutate(["tag", "--delete", name]);
  }

  async pushTag({ name, remote = null }) {
    this.validateRev(name);
    const target = await this.defaultRemote(remote);
    await this.mutate(["push", target, `refs/tags/${name}`], {
      timeout: NETWORK_TIMEOUT_MS,
    });
  }

  // --- merging and history editing -------------------------------------------

  async merge({ ref, noFastForward = false, squash = false }) {
    this.validateRev(ref);
    const args = ["merge", "--no-edit"];
    if (squash) {
      args.push("--squash");
    } else if (noFastForward) {
      args.push("--no-ff");
    }
    args.push(ref);
    return this.runMayConflict(args);
  }

  async rebase({ ref }) {
    this.validateRev(ref);
    return this.runMayConflict(["rebase", ref]);
  }

  async cherryPick({ hash }) {
    this.validateRev(hash);
    const args = ["cherry-pick"];
    if (await this.isMergeCommit(hash)) {
      args.push("--mainline=1");
    }
    args.push(hash);
    return this.runMayConflict(args);
  }

  async revert({ hash }) {
    this.validateRev(hash);
    const args = ["revert", "--no-edit"];
    if (await this.isMergeCommit(hash)) {
      args.push("--mainline=1");
    }
    args.push(hash);
    return this.runMayConflict(args);
  }

  async reset({ hash, mode = "mixed" }) {
    this.validateRev(hash);
    if (!["soft", "mixed", "hard"].includes(mode)) {
      throw new RequestError(`invalid reset mode: ${mode}`);
    }
    await this.mutate(["reset", "--quiet", `--${mode}`, hash]);
  }

  async continueOperation() {
    const operation = await this.currentOperation();
    if (!operation) {
      throw new RequestError("No merge, rebase, cherry-pick or revert is in progress.");
    }
    if (operation === "merge") {
      return this.runMayConflict(["commit", "--no-edit"]);
    }
    return this.runMayConflict([operation, "--continue"]);
  }

  async abortOperation() {
    const operation = await this.currentOperation();
    if (!operation) {
      throw new RequestError("No merge, rebase, cherry-pick or revert is in progress.");
    }
    await this.mutate([operation, "--abort"]);
  }

  // Merge-like commands exit with 1 on conflicts. Report conflicts as a result,
  // not as an error, so the plugin can show the conflicted files.
  async runMayConflict(args) {
    try {
      await this.mutate(args);
      return { conflicts: false };
    } catch (error) {
      if (error instanceof GitError && (await this.currentOperation())) {
        const status = parseStatus(
          (await this.git(["status", "--porcelain=v2", "-z"])).stdout
        );
        if (status.conflicts.length) {
          return { conflicts: true, message: error.message };
        }
      }
      throw error;
    }
  }

  async isMergeCommit(hash) {
    const { stdout } = await this.git(["rev-list", "--parents", "-n", "1", hash]);
    return stdout.trim().split(" ").length > 2;
  }

  // --- remotes -----------------------------------------------------------------

  async remotes() {
    if (!this.initialized) {
      return [];
    }
    const { stdout } = await this.git(["remote", "-v"]);
    return parseRemotes(stdout);
  }

  async addRemote({ name, url }) {
    if (!name || !/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith("-")) {
      throw new RequestError("invalid remote name");
    }
    if (typeof url !== "string" || !url.trim() || url.trim().startsWith("-")) {
      throw new RequestError("invalid remote URL");
    }
    await this.mutate(["remote", "add", name, url.trim()]);
  }

  async removeRemote({ name }) {
    await this.validateRemote(name);
    await this.mutate(["remote", "remove", name]);
  }

  async defaultRemote(requested) {
    const remotes = (await this.remotes()).map((remote) => remote.name);
    if (requested) {
      await this.validateRemote(requested);
      return requested;
    }
    if (!remotes.length) {
      throw new RequestError("No remote is set up. Add a remote first.");
    }
    return remotes.includes("origin") ? "origin" : remotes[0];
  }

  async validateRemote(name) {
    const remotes = (await this.remotes()).map((remote) => remote.name);
    if (!remotes.includes(name)) {
      throw new RequestError(`unknown remote: ${name}`);
    }
  }

  async fetch() {
    await this.mutate(["fetch", "--all", "--prune"], { timeout: NETWORK_TIMEOUT_MS });
  }

  async pull({ mode = "merge" } = {}) {
    const option = {
      "merge": "--no-rebase",
      "rebase": "--rebase",
      "ff-only": "--ff-only",
    }[mode];
    if (!option) {
      throw new RequestError(`invalid pull mode: ${mode}`);
    }
    try {
      await this.mutate(["pull", "--no-edit", option], { timeout: NETWORK_TIMEOUT_MS });
      return { conflicts: false };
    } catch (error) {
      if (error instanceof GitError && (await this.currentOperation())) {
        return { conflicts: true, message: error.message };
      }
      throw error;
    }
  }

  async push({ force = false, remote = null } = {}) {
    const { stdout } = await this.git(["symbolic-ref", "--quiet", "--short", "HEAD"], {
      okCodes: [0, 1],
    });
    const branch = stdout.trim();
    if (!branch) {
      throw new RequestError("HEAD is detached. Switch to a branch before pushing.");
    }
    const upstream = await this.git(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      { okCodes: [0, 128] }
    );
    const args = ["push"];
    if (force) {
      args.push("--force-with-lease");
    }
    if (upstream.code !== 0 || remote) {
      args.push("--set-upstream", await this.defaultRemote(remote), "HEAD");
    }
    await this.mutate(args, { timeout: NETWORK_TIMEOUT_MS });
  }

  // --- stashes -------------------------------------------------------------------

  async stashList() {
    if (!this.initialized) {
      return [];
    }
    const { stdout } = await this.git(["stash", "list", `--format=${STASH_FORMAT}`], {
      okCodes: [0, 128],
    });
    return parseStashList(stdout);
  }

  async stash({ message = "", includeUntracked = true } = {}) {
    const args = ["stash", "push", "--quiet"];
    if (includeUntracked) {
      args.push("--include-untracked");
    }
    if (message.trim()) {
      args.push(`--message=${message.trim()}`);
    }
    // With literal pathspecs, "stash --include-untracked" leaves the untracked
    // files in place; stash uses no paths here, so turn them off.
    await this.mutate(args, { env: { GIT_LITERAL_PATHSPECS: "0" } });
  }

  async stashApply({ index, pop = false }) {
    const ref = stashRef(index);
    try {
      await this.mutate(["stash", pop ? "pop" : "apply", "--quiet", ref]);
      return { conflicts: false };
    } catch (error) {
      const status = parseStatus(
        (await this.git(["status", "--porcelain=v2", "-z"])).stdout
      );
      if (status.conflicts.length) {
        return { conflicts: true, message: error.message };
      }
      throw error;
    }
  }

  async stashDrop({ index }) {
    await this.mutate(["stash", "drop", "--quiet", stashRef(index)]);
  }

  // Files changed by a stash. Untracked files saved with the stash live in its
  // third parent.
  async stashDetails({ index }) {
    this.requireRepository();
    const ref = stashRef(index);
    const { stdout: hashOut } = await this.git(["rev-parse", ref]);
    const hash = hashOut.trim();
    const { stdout: parentsOut } = await this.git([
      "rev-list",
      "--parents",
      "-n",
      "1",
      hash,
    ]);
    const parents = parentsOut.trim().split(" ").slice(1);
    const tracked = parseNameStatus(
      (await this.git(["diff", "--name-status", "-z", "-M", parents[0], hash])).stdout
    ).map((file) => ({ ...file, from: parents[0], to: hash }));
    let untracked = [];
    if (parents[2]) {
      untracked = parseNameStatus(
        (
          await this.git([
            "diff-tree",
            "--no-commit-id",
            "-r",
            "--root",
            "--name-status",
            "-z",
            parents[2],
          ])
        ).stdout
      ).map((file) => ({ ...file, status: "?", from: EMPTY, to: parents[2] }));
    }
    return { hash, files: [...tracked, ...untracked] };
  }

  // --- history -------------------------------------------------------------------

  async log({ skip = 0, maxCount = 300 } = {}) {
    this.requireRepository();
    skip = clampInteger(skip, 0, 1e7);
    maxCount = clampInteger(maxCount, 1, 5000);
    const args = [
      "log",
      "--branches",
      "--tags",
      "--remotes",
      "--date-order",
      `--format=${LOG_FORMAT}`,
      `--skip=${skip}`,
      `--max-count=${maxCount + 1}`,
    ];
    if (await this.hasCommits()) {
      args.push("HEAD");
    }
    const { stdout } = await this.git(args);
    const commits = parseLog(stdout);
    const hasMore = commits.length > maxCount;
    return { commits: commits.slice(0, maxCount), hasMore };
  }

  async commitDetails({ hash }) {
    this.validateRev(hash);
    const format = ["%H", "%P", "%an", "%ae", "%at", "%cn", "%ce", "%ct", "%B"].join(
      "%x1f"
    );
    const { stdout } = await this.git([
      "show",
      "--no-patch",
      `--format=${format}`,
      hash,
    ]);
    const [
      fullHash,
      parents,
      authorName,
      authorEmail,
      authorTime,
      committerName,
      committerEmail,
      committerTime,
      body,
    ] = stdout.split("\x1f");
    const parentList = parents ? parents.split(" ") : [];
    let files;
    if (parentList.length) {
      files = parseNameStatus(
        (await this.git(["diff", "--name-status", "-z", "-M", parentList[0], fullHash]))
          .stdout
      );
    } else {
      files = parseNameStatus(
        (
          await this.git([
            "diff-tree",
            "--no-commit-id",
            "-r",
            "--root",
            "--name-status",
            "-z",
            "-M",
            fullHash,
          ])
        ).stdout
      );
    }
    const from = parentList[0] ?? EMPTY;
    return {
      hash: fullHash,
      parents: parentList,
      authorName,
      authorEmail,
      authorTime: Number(authorTime),
      committerName,
      committerEmail,
      committerTime: Number(committerTime),
      message: (body ?? "").replace(/\n+$/, ""),
      files: files.map((file) => ({ ...file, from, to: fullHash })),
    };
  }

  // --- file contents and diffs -----------------------------------------------------

  // Returns { exists, binary, size, text } for a file at a revision spec
  async readFile({ rev, path: filePath }) {
    const buffer = await this.readFileBuffer(rev, filePath);
    return describeBuffer(buffer);
  }

  async readFileBuffer(rev, filePath) {
    this.requireRepository();
    const [checkedPath] = this.validatePaths([filePath]);
    if (rev === EMPTY) {
      return null;
    }
    if (rev === WORKTREE) {
      const absolute = path.join(this.root, ...checkedPath.split("/"));
      let resolved;
      try {
        resolved = await realpath(absolute);
      } catch (error) {
        return null;
      }
      if (!isInside(await realpath(this.root), resolved)) {
        throw new RequestError("file is outside the repository");
      }
      return readFile(resolved);
    }
    const spec =
      rev === INDEX ? `:${checkedPath}` : `${this.validateRev(rev)}:${checkedPath}`;
    const result = await this.git(["cat-file", "blob", spec], {
      binary: true,
      okCodes: [0, 128],
    });
    if (result.code !== 0) {
      return null;
    }
    if (result.stdout.length > MAX_FILE_BYTES) {
      throw new RequestError(`file is larger than ${MAX_FILE_BYTES} bytes`);
    }
    return result.stdout;
  }

  // Compares a file between two revision specs. Returns the unified diff text
  // (patch) and, when contents is set, both versions of the file.
  async diff({
    from,
    to,
    path: filePath,
    oldPath = null,
    contents = false,
    context = 3,
  }) {
    const oldBuffer = await this.readFileBuffer(from, oldPath ?? filePath);
    const newBuffer = await this.readFileBuffer(to, filePath);
    const oldFile = describeBuffer(oldBuffer, contents);
    const newFile = describeBuffer(newBuffer, contents);
    let patch = "";
    if (!oldFile.binary && !newFile.binary) {
      patch = await diffBuffers(oldBuffer, newBuffer, clampInteger(context, 0, 1000));
    }
    return { old: oldFile, new: newFile, patch };
  }

  // --- validation ----------------------------------------------------------------

  validatePaths(paths) {
    if (!Array.isArray(paths) || !paths.length) {
      throw new RequestError("no paths given");
    }
    return paths.map((p) => {
      if (
        typeof p !== "string" ||
        !p ||
        p.includes("\0") ||
        p.startsWith("/") ||
        /^[A-Za-z]:/.test(p) ||
        p.split("/").some((segment) => segment === ".." || segment === "")
      ) {
        throw new RequestError(`invalid path: ${p}`);
      }
      return p;
    });
  }

  validateRev(rev) {
    if (
      typeof rev !== "string" ||
      !/^[A-Za-z0-9_][A-Za-z0-9._/@{}^~+-]*$/.test(rev) ||
      rev.includes("..")
    ) {
      throw new RequestError(`invalid revision: ${rev}`);
    }
    return rev;
  }

  async validateBranchName(name) {
    if (typeof name !== "string" || !name || name.startsWith("-")) {
      throw new RequestError("invalid branch name");
    }
    const { code } = await runGit(["check-ref-format", "--branch", name], {
      cwd: this.root ?? this.workDir,
      okCodes: [0, 1, 128],
    });
    if (code !== 0) {
      throw new RequestError(`invalid branch name: ${name}`);
    }
  }

  async validateRefFormat(refName) {
    const { code } = await this.git(["check-ref-format", refName], {
      okCodes: [0, 1],
    });
    if (code !== 0) {
      throw new RequestError(`invalid name: ${refName}`);
    }
  }
}

function stashRef(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new RequestError(`invalid stash index: ${index}`);
  }
  return `stash@{${index}}`;
}

function clampInteger(value, min, max) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.min(max, Math.max(min, number));
}

export function isBinary(buffer) {
  return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

function describeBuffer(buffer, includeText = true) {
  if (buffer === null) {
    return {
      exists: false,
      binary: false,
      size: 0,
      text: includeText ? "" : undefined,
    };
  }
  const binary = isBinary(buffer);
  const description = { exists: true, binary, size: buffer.length };
  if (includeText && !binary) {
    description.text = buffer.toString("utf8");
  }
  return description;
}

// Unified diff of two buffers through `git diff --no-index`, which works for any
// pair of versions (commits, the index or the working tree).
async function diffBuffers(oldBuffer, newBuffer, context) {
  const folder = await mkdtemp(path.join(os.tmpdir(), "fontra-git-bridge-"));
  try {
    await writeFile(path.join(folder, "old"), oldBuffer ?? "");
    await writeFile(path.join(folder, "new"), newBuffer ?? "");
    const { stdout } = await runGit(
      [
        "diff",
        "--no-index",
        "--no-color",
        "--no-ext-diff",
        `--unified=${context}`,
        "--",
        "old",
        "new",
      ],
      { cwd: folder, okCodes: [0, 1] }
    );
    return stdout;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
