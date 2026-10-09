#!/usr/bin/env node
// Starts the git bridge for the Fontra Source Control plugin.
//
//   node bridge/cli.js [FOLDER] [--port 8765] [--host 127.0.0.1] [--allow-origin URL]
//
// Without FOLDER the bridge works with any font Fontra opens. With FOLDER it
// only works with fonts inside that folder.

import { parseArgs } from "node:util";
import { resolveRoot } from "./project.js";
import { createBridgeServer, isLocalHostHeader } from "./server.js";

const DEFAULT_PORT = 8765;

const usage = `Usage: fontra-git-bridge [FOLDER] [options]

Runs git for the Fontra Source Control plugin. Keep it running while you use
the plugin; press Ctrl+C to stop it.

FOLDER          Optional. Only work with fonts inside this folder. Without it,
                the bridge works with any font Fontra opens.

Options:
  --port N            Port to listen on (default ${DEFAULT_PORT})
  --host HOST         Address to listen on (default 127.0.0.1)
  --allow-origin URL  Also accept requests from this origin (repeatable).
                      Pages on localhost / 127.0.0.1 are always accepted.
  --quiet             Do not log each request
  -h, --help          Show this help
`;

function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        "port": { type: "string", default: String(DEFAULT_PORT) },
        "host": { type: "string", default: "127.0.0.1" },
        "allow-origin": { type: "string", multiple: true, default: [] },
        "quiet": { type: "boolean", default: false },
        "help": { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    console.error(error.message);
    console.error(usage);
    process.exit(2);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(usage);
    return;
  }
  if (positionals.length > 1) {
    console.error(usage);
    process.exit(2);
  }

  let root;
  try {
    root = resolveRoot(positionals[0]);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`invalid port: ${values.port}`);
    process.exit(2);
  }
  if (!isLocalHostHeader(values.host)) {
    console.warn(
      `warning: listening on ${values.host}. Requests must still name localhost ` +
        "as their host, so the bridge is only usable from this computer."
    );
  }

  const server = createBridgeServer({
    root,
    allowedOrigins: values["allow-origin"],
    log: values.quiet ? () => {} : (line) => console.log(`[bridge] ${line}`),
  });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Pass --port to use another one.`);
    } else {
      console.error(error.message);
    }
    process.exit(1);
  });
  server.listen(port, values.host, () => {
    console.log(`Fontra git bridge is running on http://localhost:${port}`);
    console.log(
      root === null
        ? "It works with any font that Fontra opens."
        : `It works with fonts inside ${root}`
    );
    console.log("Keep this window open while you use Fontra. Press Ctrl+C to stop.");
  });
}

main();
