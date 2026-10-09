// Maps a Fontra project identifier to a folder on disk, following the rules
// of Fontra's filesystem project manager (fontra/filesystem/projectmanager.py):
//
// - Fontra started with a folder: the identifier is a "/"-separated path
//   relative to that folder.
// - Fontra started with a single font file: the folder is the file's parent.
// - Fontra started with "-" (and Fontra Pak): the identifier is an absolute
//   path, possibly without its leading "/".

import { existsSync, statSync } from "node:fs";
import path from "node:path";

export class ProjectError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProjectError";
  }
}

// rootArgument is what the user passed on the command line: a folder, a font
// file or "-". Returns the folder that project identifiers are relative to, or
// null for "-".
export function resolveRoot(rootArgument, cwd = process.cwd()) {
  if (rootArgument === "-") {
    return null;
  }
  const resolved = path.resolve(cwd, rootArgument ?? ".");
  if (!existsSync(resolved)) {
    throw new ProjectError(`path does not exist: ${resolved}`);
  }
  if (statSync(resolved).isDirectory() && !looksLikeFontPackage(resolved)) {
    return resolved;
  }
  return path.dirname(resolved);
}

// Font formats stored as folders
const PACKAGE_EXTENSIONS = new Set([".ufo", ".ufoz", ".fontra", ".glyphspackage"]);

function looksLikeFontPackage(folder) {
  return PACKAGE_EXTENSIONS.has(path.extname(folder).toLowerCase());
}

// Returns { projectPath, workDir }: the font's own path, and the folder that
// git commands run in (the folder containing the font).
export function resolveProject(root, projectIdentifier) {
  if (typeof projectIdentifier !== "string" || !projectIdentifier) {
    throw new ProjectError("missing project identifier");
  }
  if (projectIdentifier.includes("\0")) {
    throw new ProjectError("invalid project identifier");
  }
  let projectPath;
  if (root === null) {
    projectPath = projectIdentifier;
    if (!/^[A-Za-z]:[\\/]/.test(projectPath) && !projectPath.startsWith("/")) {
      projectPath = "/" + projectPath;
    }
    projectPath = path.resolve(projectPath);
  } else {
    const segments = projectIdentifier.split("/");
    if (segments.some((segment) => segment === ".." || segment === "")) {
      throw new ProjectError("invalid project identifier");
    }
    projectPath = path.resolve(root, ...segments);
    if (!isInside(root, projectPath)) {
      throw new ProjectError("project is outside the bridge's folder");
    }
  }
  if (!existsSync(projectPath)) {
    throw new ProjectError(`project not found: ${projectPath}`);
  }
  return { projectPath, workDir: path.dirname(projectPath) };
}

export function isInside(folder, target) {
  const relative = path.relative(folder, target);
  return (
    relative === "" ||
    (relative.split(path.sep)[0] !== ".." && !path.isAbsolute(relative))
  );
}
