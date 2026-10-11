// VS Code extension entry point. Shows changes of glyph and kerning files as
// drawings, with the diff view of the Fontra Source Control plugin, and
// previews glyph and kerning files while they are edited.

import path from "node:path";
import * as vscode from "vscode";
import { locateFont } from "../../src/formats/font-files.js";
import { GitFiles } from "./git-files.mjs";
import { FontPanel } from "./panels.mjs";
import {
  EMPTY,
  INDEX,
  WORKTREE,
  changesRequest,
  commitRequest,
  isFontFile,
  isInsideFont,
  revisionFromGitQuery,
  toPosixPath,
} from "./requests.mjs";

const PREVIEW_UPDATE_DELAY_MS = 200;
const REFRESH_DELAY_MS = 500;

let extensionContext;
const previews = new Map(); // document URI → FontPanel
const diffs = new Map(); // request key → FontPanel

export function activate(context) {
  extensionContext = context;
  const commands = {
    "fontraGlyphDiff.openChanges": openChanges,
    "fontraGlyphDiff.showHistory": showHistory,
    "fontraGlyphDiff.openPreview": openPreview,
    "fontraGlyphDiff.openTimelineChanges": openTimelineChanges,
  };
  for (const [id, command] of Object.entries(commands)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args) => {
        try {
          await command(...args);
        } catch (error) {
          vscode.window.showErrorMessage(errorMessage(error));
        }
      })
    );
  }
  // For the integration tests: whether each panel's page has started and
  // asked for files
  return {
    panels: () =>
      [...previews.values(), ...diffs.values()].map((panel) => ({
        title: panel.panel.title,
        ready: panel.ready,
        requestCount: panel.requestCount,
      })),
  };
}

export function deactivate() {}

// --- commands ------------------------------------------------------------------

// From a Source Control row, an editor title, the Explorer or the Command
// Palette. In a diff editor, compares the two sides it shows.
async function openChanges(arg) {
  const tabRequest = await requestFromDiffTab(arg);
  if (tabRequest) {
    showDiff(tabRequest);
    return;
  }
  const uri = targetUri(arg);
  const group =
    typeof arg?.resourceGroupType === "number" ? arg.resourceGroupType : undefined;
  const { files, path: filePath } = await openRepository(uri);
  const status = await files.status();
  showDiff({ files, ...changesRequest(filePath, group, status) });
}

// Picks a commit that changed the file and shows its changes
async function showHistory(arg) {
  const uri = targetUri(arg);
  const { files, path: filePath } = await openRepository(uri);
  const commits = await files.fileLog(filePath);
  if (!commits.length) {
    vscode.window.showInformationMessage(
      vscode.l10n.t("No commits have changed {0} yet.", path.basename(uri.fsPath))
    );
    return;
  }
  const picked = await vscode.window.showQuickPick(
    commits.map((commit) => ({
      label: commit.subject || commit.shortHash,
      description: `${commit.shortHash} · ${commit.author}`,
      detail: new Date(commit.time * 1000).toLocaleString(vscode.env.language),
      commit,
    })),
    {
      title: vscode.l10n.t("Changes of {0}", path.basename(uri.fsPath)),
      placeHolder: vscode.l10n.t("Pick a commit to see what it changed"),
      matchOnDescription: true,
    }
  );
  if (picked) {
    showDiff({ files, ...commitRequest(picked.commit, filePath) });
  }
}

// From the Timeline view: a commit of the file, against the commit before it
async function openTimelineChanges(item, uri) {
  if (!item?.ref || !uri) {
    throw new Error(
      vscode.l10n.t("Open the changes from a commit in the Timeline view.")
    );
  }
  const { files, path: filePath } = await openRepository(uri);
  showDiff({
    files,
    path: filePath,
    oldPath: null,
    from: item.previousRef || `${item.ref}^`,
    to: item.ref,
    status: "M",
  });
}

async function openPreview(arg) {
  const uri = targetUri(arg);
  if (!isFontFile(uri.path)) {
    throw new Error(unsupportedMessage(uri));
  }
  const key = uri.toString();
  if (previews.has(key)) {
    previews.get(key).reveal();
    return;
  }
  const filePath = toPosixPath(uri.fsPath);
  const fontPath = locateFont(filePath)?.fontPath ?? filePath;
  let document = null;
  try {
    document = await vscode.workspace.openTextDocument(uri);
  } catch (error) {
    // Files over VS Code's size limit for extensions are read from disk
  }
  const panel = new FontPanel(extensionContext, {
    title: vscode.l10n.t("Preview {0}", path.basename(uri.fsPath)),
    // Next to the editor, which keeps the focus so typing goes on
    column: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    init: {
      mode: "preview",
      path: filePath,
      displayPath: toPosixPath(vscode.workspace.asRelativePath(uri)),
      text: document ? document.getText() : await readDiskText(uri),
    },
    handlers: {
      readText: async ({ path: requested }) => {
        if (typeof requested !== "string" || !isInsideFont(fontPath, requested)) {
          throw new Error(`not part of this font: ${requested}`);
        }
        return readText(vscode.Uri.file(requested));
      },
    },
    onDispose: () => previews.delete(key),
  });
  previews.set(key, panel);
  // The previewed file updates as it is typed; other files of the font (base
  // glyphs of components, glyphs of kerning pairs) when they change
  let updateTimer = null;
  let refreshTimer = null;
  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => panel.post({ type: "refresh" }), REFRESH_DELAY_MS);
  };
  const inFont = (changed) => isInsideFolder(fontPath, changed.fsPath);
  panel.disposables.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === key) {
        clearTimeout(updateTimer);
        updateTimer = setTimeout(
          () => panel.post({ type: "update", text: event.document.getText() }),
          PREVIEW_UPDATE_DELAY_MS
        );
      } else if (event.document.uri.scheme === "file" && inFont(event.document.uri)) {
        scheduleRefresh();
      }
    }),
    { dispose: () => (clearTimeout(updateTimer), clearTimeout(refreshTimer)) }
  );
  // A .glyphs file holds the whole font; UFO, .fontra and .glyphspackage
  // fonts are folders of files
  if (fontPath !== filePath) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(fontPath), "**/*")
    );
    panel.disposables.push(
      watcher,
      watcher.onDidChange((changed) => changed.toString() !== key && scheduleRefresh()),
      watcher.onDidCreate(scheduleRefresh),
      watcher.onDidDelete(scheduleRefresh)
    );
  }
}

// --- diff panels ---------------------------------------------------------------

function showDiff({ files, path: filePath, oldPath, from, to, status }) {
  if (!isFontFile(filePath) && !(oldPath && isFontFile(oldPath))) {
    throw new Error(unsupportedMessage(vscode.Uri.file(files.absolutePath(filePath))));
  }
  const key = JSON.stringify([files.root, filePath, oldPath, from, to]);
  if (diffs.has(key)) {
    diffs.get(key).reveal();
    return;
  }
  const fromLabel = revisionLabel(from);
  const toLabel = revisionLabel(to);
  const name = path.posix.basename(filePath);
  const panel = new FontPanel(extensionContext, {
    title: `${name} (${[fromLabel, toLabel].filter(Boolean).join(" ↔ ")})`,
    column: vscode.ViewColumn.Active,
    init: {
      mode: "diff",
      request: { path: filePath, oldPath, from, to, fromLabel, toLabel, status },
    },
    handlers: {
      readText: ({ rev, path: requested }) => files.readText(rev, requested),
      diff: (params) => files.diff(params),
    },
    onDispose: () => diffs.delete(key),
  });
  diffs.set(key, panel);
  if (to === WORKTREE || to === INDEX) {
    // Uncommitted changes: redraw when the font's files are saved or staged
    const fontPath = locateFont(filePath)?.fontPath ?? filePath;
    let timer = null;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => panel.post({ type: "refresh" }), REFRESH_DELAY_MS);
    };
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(files.root),
        `{${fontPath},${fontPath}/**,.git/index}`
      )
    );
    panel.disposables.push(
      watcher,
      watcher.onDidChange(refresh),
      watcher.onDidCreate(refresh),
      watcher.onDidDelete(refresh),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (
          to === WORKTREE &&
          event.document.uri.scheme === "file" &&
          isInsideFolder(files.absolutePath(fontPath), event.document.uri.fsPath)
        ) {
          refresh();
        }
      }),
      { dispose: () => clearTimeout(timer) }
    );
  }
}

// The two sides of the active diff editor, when the command was started from
// its title bar (or from the Command Palette while it is active)
async function requestFromDiffTab(arg) {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (!(input instanceof vscode.TabInputTextDiff)) {
    return null;
  }
  if (arg instanceof vscode.Uri) {
    if (arg.toString() !== input.modified.toString()) {
      return null;
    }
  } else if (arg !== undefined) {
    return null;
  }
  const from = revisionOfUri(input.original);
  const to = revisionOfUri(input.modified);
  if (!from || !to) {
    return null;
  }
  const { files, path: filePath } = await openRepository(input.modified);
  const original = await GitFiles.forFile(input.original.fsPath, unsavedText).catch(
    () => null
  );
  const oldPath =
    original && original.path !== filePath && original.files.root === files.root
      ? original.path
      : null;
  return {
    files,
    path: filePath,
    oldPath,
    from,
    to,
    status: oldPath ? "R" : "M",
  };
}

function revisionOfUri(uri) {
  if (uri.scheme === "file") {
    return WORKTREE;
  }
  if (uri.scheme === "git") {
    return revisionFromGitQuery(uri.query);
  }
  return null;
}

function revisionLabel(rev) {
  switch (rev) {
    case WORKTREE:
      return vscode.l10n.t("Working Tree");
    case INDEX:
      return vscode.l10n.t("Index");
    case EMPTY:
      return "";
  }
  return /^[0-9a-f]{40}$/.test(rev) ? rev.slice(0, 7) : rev;
}

// --- files -------------------------------------------------------------------------

// The file a command applies to: the URI it was started on, a Source
// Control row, or the active editor
function targetUri(arg) {
  if (arg instanceof vscode.Uri) {
    return fileUri(arg);
  }
  if (arg?.resourceUri instanceof vscode.Uri) {
    return fileUri(arg.resourceUri);
  }
  const uri = vscode.window.activeTextEditor?.document.uri;
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const tabUri = input instanceof vscode.TabInputTextDiff ? input.modified : input?.uri;
  const target = uri ?? tabUri;
  if (!target) {
    throw new Error(vscode.l10n.t("Open a glyph or kerning file first."));
  }
  return fileUri(target);
}

// git: URIs of the built-in git extension carry the file's path
function fileUri(uri) {
  if (uri.scheme === "file") {
    return uri;
  }
  if (uri.scheme === "git") {
    return vscode.Uri.file(uri.fsPath);
  }
  throw new Error(vscode.l10n.t("Only files on this computer can be shown."));
}

async function openRepository(uri) {
  try {
    return await GitFiles.forFile(uri.fsPath, unsavedText);
  } catch (error) {
    if (
      error?.message === "not-a-repository" ||
      error?.message === "outside-repository"
    ) {
      throw new Error(
        vscode.l10n.t("{0} is not in a git repository.", path.basename(uri.fsPath))
      );
    }
    throw error;
  }
}

// The text of an open editor with unsaved changes, or null
function unsavedText(absolutePath) {
  const target = normalizePath(absolutePath);
  const document = vscode.workspace.textDocuments.find(
    (doc) =>
      doc.uri.scheme === "file" &&
      doc.isDirty &&
      normalizePath(doc.uri.fsPath) === target
  );
  return document ? document.getText() : null;
}

// True for the folder (or file) itself and everything inside it
function isInsideFolder(folder, filePath) {
  return isInsideFont(
    toPosixPath(normalizePath(folder)),
    toPosixPath(normalizePath(filePath))
  );
}

function normalizePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" || process.platform === "darwin"
    ? resolved.toLowerCase()
    : resolved;
}

async function readText(uri) {
  const open = unsavedText(uri.fsPath);
  return open ?? readDiskText(uri);
}

async function readDiskText(uri) {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder("utf-8").decode(bytes);
  } catch (error) {
    return null;
  }
}

function unsupportedMessage(uri) {
  return vscode.l10n.t(
    "{0} is not a glyph or kerning file. Glyph files are .glif (UFO), glyphs/*.json (.fontra), glyphs/*.glyph (.glyphspackage) and .glyphs; kerning files are kerning.plist and groups.plist (UFO), kerning.csv (.fontra) and fontinfo.plist (.glyphspackage).",
    path.basename(uri.fsPath)
  );
}

function errorMessage(error) {
  return error?.message ?? String(error);
}
