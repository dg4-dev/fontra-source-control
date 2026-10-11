// Bundles the extension (dist/extension.js, run by VS Code in Node) and the
// page of its panels (dist/webview.js), both with the Fontra plugin's code
// from ../src and the git bridge's from ../bridge.
//
//   node build.mjs               build once
//   node build.mjs --watch       rebuild on changes
//   node build.mjs --production  minified, without source maps

import { copyFile, mkdir } from "node:fs/promises";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: "info",
  legalComments: "none",
};

const builds = [
  {
    ...common,
    entryPoints: ["src/extension.mjs"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    target: "node18",
    external: ["vscode"],
  },
  {
    ...common,
    entryPoints: ["webview/main.mjs"],
    outfile: "dist/webview.js",
    platform: "browser",
    format: "iife",
    target: "es2022",
  },
];

await mkdir("dist", { recursive: true });
// The panel icon, and the license that the package must contain
await copyFile("../icon.svg", "dist/icon.svg");
await copyFile("../LICENSE", "LICENSE");

if (watch) {
  for (const options of builds) {
    const context = await esbuild.context(options);
    await context.watch();
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
