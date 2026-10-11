// Starts VS Code with the extension and the tests in suite.cjs on a font in a
// temporary git repository. VS Code is downloaded into .vscode-test/ the
// first time. On Linux without a display, run it under xvfb-run.
//
//   npm run test:integration

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";
import { makeFixture } from "./fixture.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const folder = mkdtempSync(path.join(os.tmpdir(), "fontra-glyph-diff-it-"));
try {
  await makeFixture(folder);
  await runTests({
    extensionDevelopmentPath: path.resolve(here, "../.."),
    extensionTestsPath: path.join(here, "suite.cjs"),
    extensionTestsEnv: { FONTRA_TEST_FOLDER: folder },
    launchArgs: [
      folder,
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
    ],
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  rmSync(folder, { recursive: true, force: true });
}
