// Runs inside VS Code (see run.mjs). Opens previews and diffs the ways a
// user would, and checks that their pages start and read the font.

const assert = require("node:assert/strict");
const path = require("node:path");
const vscode = require("vscode");

const folder = process.env.FONTRA_TEST_FOLDER;
const fileUri = (file) => vscode.Uri.file(path.join(folder, "Demo.ufo", file));

async function waitFor(check, what, timeout = 20000) {
  const start = Date.now();
  for (;;) {
    const result = check();
    if (result) {
      return result;
    }
    if (Date.now() - start > timeout) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

let api;

// The panel with this title, once its page has started and read at least
// minRequests files
function waitForPanel(title, minRequests = 0) {
  return waitFor(
    () =>
      api
        .panels()
        .find(
          (panel) =>
            panel.title === title && panel.ready && panel.requestCount >= minRequests
        ),
    `panel "${title}" (have: ${JSON.stringify(api.panels())})`
  );
}

test("commands are registered", async () => {
  const commands = await vscode.commands.getCommands(true);
  for (const id of [
    "openChanges",
    "showHistory",
    "openPreview",
    "openTimelineChanges",
  ]) {
    assert.ok(commands.includes(`fontraPreview.${id}`), id);
  }
});

test("preview of the active editor's glyph reads its components", async () => {
  await vscode.window.showTextDocument(fileUri("glyphs/A_acute.glif"));
  await vscode.commands.executeCommand("fontraPreview.openPreview");
  await waitForPanel("Preview A_acute.glif", 1);
});

test("preview of a kerning file from the Explorer", async () => {
  await vscode.commands.executeCommand(
    "fontraPreview.openPreview",
    fileUri("kerning.plist")
  );
  await waitForPanel("Preview kerning.plist", 1);
});

test("uncommitted changes of a glyph", async () => {
  await vscode.commands.executeCommand(
    "fontraPreview.openChanges",
    fileUri("glyphs/A_.glif")
  );
  await waitForPanel("A_.glif (HEAD ↔ Working Tree)", 2);
});

test("a diff of uncommitted changes redraws when the file changes on disk", async () => {
  const title = "A_.glif (HEAD ↔ Working Tree)";
  const before = (await waitForPanel(title, 2)).requestCount;
  const glif = fileUri("glyphs/A_.glif");
  const text = Buffer.from(await vscode.workspace.fs.readFile(glif)).toString("utf8");
  await vscode.workspace.fs.writeFile(
    glif,
    Buffer.from(text.replace('width="640"', 'width="660"'))
  );
  await waitForPanel(title, before + 2);
});

test("uncommitted changes of the kerning", async () => {
  await vscode.commands.executeCommand(
    "fontraPreview.openChanges",
    fileUri("kerning.plist")
  );
  await waitForPanel("kerning.plist (HEAD ↔ Working Tree)", 2);
});

test("the two sides of a diff editor", async () => {
  const modified = fileUri("glyphs/O_.glif");
  const original = modified.with({
    scheme: "git",
    // "~": the index, as VS Code's own diff of unstaged changes has it
    query: JSON.stringify({ path: modified.fsPath, ref: "~" }),
  });
  await vscode.commands.executeCommand("vscode.diff", original, modified, "O_.glif");
  await waitFor(
    () =>
      vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof
      vscode.TabInputTextDiff,
    "the diff editor"
  );
  await vscode.commands.executeCommand("fontraPreview.openChanges", modified);
  await waitForPanel("O_.glif (Index ↔ Working Tree)", 2);
});

test("a commit picked from the file's history", async () => {
  const done = vscode.commands.executeCommand(
    "fontraPreview.showHistory",
    fileUri("kerning.plist")
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
  await done;
  // The first commit added the file, so there is nothing to compare it with
  await waitFor(
    () =>
      api
        .panels()
        .find(
          (panel) => /^kerning\.plist \([0-9a-f]{7}\)$/.test(panel.title) && panel.ready
        ),
    `history panel (have: ${JSON.stringify(api.panels())})`
  );
});

test("files that are not glyphs or kerning open nothing", async () => {
  const before = api.panels().length;
  await vscode.commands.executeCommand(
    "fontraPreview.openPreview",
    fileUri("fontinfo.plist")
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(api.panels().length, before);
});

exports.run = async () => {
  const extension = vscode.extensions.all.find(
    (candidate) => candidate.packageJSON.name === "fontra-preview"
  );
  api = await extension.activate();
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      failed++;
      console.log(`not ok - ${name}\n  ${error.stack ?? error}`);
    }
  }
  console.log(`${tests.length - failed} of ${tests.length} passed`);
  if (failed) {
    throw new Error(`${failed} integration tests failed`);
  }
};
