// Maps the project the plugin sends to a folder on disk.
//
// The plugin sends the font's absolute path, which Fontra reports through
// getMetaInfo(). As a fallback it sends Fontra's project identifier from the
// editor URL, which follows the rules of Fontra's filesystem project manager
// (fontra/filesystem/projectmanager.py):
//
// - Fontra started with a folder: a "/"-separated path relative to that folder.
// - Fontra started with "-": an absolute path without its leading "/".
//
// The bridge accepts any font project by absolute path unless it was started
// with a folder, which then limits it to fonts inside that folder.

import { existsSync, statSync } from "node:fs";
import path from "node:path";

export class ProjectError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProjectError";
  }
}

// File extensions of the fonts Fontra opens (its own backends and the
// fontra-glyphs and fontra-rcjk plugins). The bridge refuses other paths, so
// it can only run git next to font projects.
export const FONT_EXTENSIONS = new Set([
  ".designspace",
  ".ufo",
  ".ufoz",
  ".fontra",
  ".glyphs",
  ".glyphspackage",
  ".rcjk",
  ".ttf",
  ".otf",
  ".ttx",
  ".woff",
  ".woff2",
]);

// rootArgument is the optional folder (or font file) given on the command
// line. Returns the folder the bridge is limited to, or null for no limit
// (no argument, or "-").
export function resolveRoot(rootArgument, cwd = process.cwd()) {
  if (rootArgument === undefined || rootArgument === null || rootArgument === "-") {
    return null;
  }
  const resolved = path.resolve(cwd, rootArgument);
  if (!existsSync(resolved)) {
    throw new ProjectError(`path does not exist: ${resolved}`);
  }
  if (statSync(resolved).isDirectory() && !isFontPath(resolved)) {
    return resolved;
  }
  return path.dirname(resolved);
}

export function isFontPath(filePath) {
  return FONT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isAbsoluteIdentifier(identifier) {
  return (
    identifier.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(identifier) ||
    identifier.startsWith("\\\\")
  );
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
  if (isAbsoluteIdentifier(projectIdentifier)) {
    projectPath = path.resolve(projectIdentifier);
  } else if (root === null) {
    // Fontra started with "-" drops the leading "/" of absolute paths
    projectPath = path.resolve("/" + projectIdentifier);
  } else {
    const segments = projectIdentifier.split("/");
    if (segments.some((segment) => segment === ".." || segment === "")) {
      throw new ProjectError("invalid project identifier");
    }
    projectPath = path.resolve(root, ...segments);
  }
  if (root !== null && !isInside(root, projectPath)) {
    throw new ProjectError(`the font is outside the bridge's folder (${root})`);
  }
  if (!isFontPath(projectPath)) {
    throw new ProjectError(`not a font project: ${projectPath}`);
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
