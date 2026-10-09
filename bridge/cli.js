#!/usr/bin/env node
// Starts the git bridge for the Fontra Source Control plugin.
//
//   node bridge/cli.js [PATH] [--port 8765] [--host 127.0.0.1] [--allow-origin URL]
//
// PATH is the same folder or font file that Fontra was started with, or "-"
// when Fontra opens fonts by absolute path (fontra filesystem -, Fontra Pak).

import { parseArgs } from "node:util";
import { resolveRoot } from "./project.js";
import { createBridgeServer, isLocalHostHeader } from "./server.js";

const DEFAULT_PORT = 8765;

const usage = `Usage: fontra-git-bridge [PATH] [options]

PATH            The folder or font file Fontra was started with, or "-" to accept
                absolute project paths (fontra filesystem -, Fontra Pak).
                Defaults to the current folder.

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
    root = resolveRoot(positionals[0] ?? ".");
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
    console.log(`Fontra git bridge listening on http://localhost:${port}`);
    console.log(
      root === null ? "Projects: absolute paths" : `Projects: relative to ${root}`
    );
  });
}

main();
