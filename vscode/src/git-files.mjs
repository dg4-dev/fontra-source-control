// Reads the versions of a file that the diff view compares, reusing the git
// bridge's Repository class. Unsaved edits of open editors count as the
// working tree, so a diff shows what the editor shows.

import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  Repository,
  RequestError,
  describeBuffer,
  diffBuffers,
} from "../../bridge/repository.js";
import { LOG_FORMAT, WORKTREE, parseFileLog } from "./requests.mjs";

export class GitFiles {
  // unsavedText(absolutePath): the text of an open editor with unsaved
  // changes, or null
  constructor(repository, unsavedText = () => null) {
    this.repository = repository;
    this.unsavedText = unsavedText;
  }

  // Opens the repository that contains a file. Returns { files, path } with
  // the file's path relative to the repository (with "/"), or throws.
  static async forFile(absolutePath, unsavedText) {
    const folder = await existingFolder(path.dirname(absolutePath));
    const repository = await Repository.open(folder);
    if (!repository.initialized) {
      throw new RequestError("not-a-repository");
    }
    const root = await realpath(repository.root);
    const resolved = await resolveExisting(absolutePath);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new RequestError("outside-repository");
    }
    return {
      files: new GitFiles(repository, unsavedText),
      path: relative.split(path.sep).join("/"),
    };
  }

  get root() {
    return this.repository.root;
  }

  absolutePath(filePath) {
    return path.join(this.repository.root, ...filePath.split("/"));
  }

  async readBuffer(rev, filePath) {
    if (rev === WORKTREE) {
      this.repository.validatePaths([filePath]);
      const text = this.unsavedText(this.absolutePath(filePath));
      if (text !== null && text !== undefined) {
        return Buffer.from(text, "utf8");
      }
    }
    return this.repository.readFileBuffer(rev, filePath);
  }

  // Text of a file at a revision spec, or null when it does not exist there
  // or is binary (same as the plugin's BridgeClient.readText)
  async readText(rev, filePath) {
    const file = describeBuffer(await this.readBuffer(rev, filePath));
    return file.exists && !file.binary ? file.text : null;
  }

  // Same result as the bridge's "diff" command
  async diff({ path: filePath, oldPath = null, from, to }) {
    const oldBuffer = await this.readBuffer(from, oldPath ?? filePath);
    const newBuffer = await this.readBuffer(to, filePath);
    const oldFile = describeBuffer(oldBuffer, false);
    const newFile = describeBuffer(newBuffer, false);
    let patch = "";
    if (!oldFile.binary && !newFile.binary) {
      patch = await diffBuffers(oldBuffer, newBuffer, 3);
    }
    return { old: oldFile, new: newFile, patch };
  }

  status() {
    return this.repository.status();
  }

  // Commits that changed a file, newest first
  async fileLog(filePath, maxCount = 200) {
    this.repository.validatePaths([filePath]);
    const { stdout } = await this.repository.git([
      "log",
      `--format=${LOG_FORMAT}`,
      "--name-status",
      "-M",
      `--max-count=${maxCount}`,
      "--",
      filePath,
    ]);
    return parseFileLog(stdout);
  }

  async hasCommits() {
    return this.repository.hasCommits();
  }
}

// The nearest folder that exists, for files in folders that were deleted
async function existingFolder(folder) {
  const base = await existingAncestor(folder);
  return realpath(base);
}

// Resolves symbolic links in the part of the path that exists, so the path can
// be compared with git's (resolved) top level folder
async function resolveExisting(absolutePath) {
  const base = await existingAncestor(absolutePath);
  return path.join(await realpath(base), path.relative(base, absolutePath));
}

async function existingAncestor(target) {
  let current = path.resolve(target);
  for (;;) {
    try {
      await realpath(current);
      return current;
    } catch (error) {
      const parent = path.dirname(current);
      if (parent === current) {
        return current;
      }
      current = parent;
    }
  }
}
