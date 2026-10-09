// Local HTTP server that the plugin talks to. Every request is a POST to
// /api/<command> with a JSON body; the body's "project" field is the Fontra
// project identifier, which picks the repository.
//
// The server only accepts requests from pages served on this computer
// (localhost origins) and addressed to a local host name, so other web sites
// open in the browser cannot run git commands through it.

import http from "node:http";
import { GitError } from "./git.js";
import { ProjectError, resolveProject } from "./project.js";
import { Repository, RequestError } from "./repository.js";

export const BRIDGE_NAME = "fontra-git-bridge";
export const BRIDGE_VERSION = 1;
const MAX_BODY_BYTES = 1024 * 1024;

// Commands the plugin can call: name → (repository, params) => result
const COMMANDS = {
  status: (repo) => repo.status(),
  init: (repo, params) => repo.init(params),
  stage: (repo, params) => repo.stage(params),
  stageAll: (repo) => repo.stageAll(),
  unstage: (repo, params) => repo.unstage(params),
  unstageAll: (repo) => repo.unstageAll(),
  discard: (repo, params) => repo.discard(params),
  commit: (repo, params) => repo.commit(params),
  refs: (repo) => repo.refs(),
  checkout: (repo, params) => repo.checkout(params),
  createBranch: (repo, params) => repo.createBranch(params),
  deleteBranch: (repo, params) => repo.deleteBranch(params),
  renameBranch: (repo, params) => repo.renameBranch(params),
  deleteRemoteBranch: (repo, params) => repo.deleteRemoteBranch(params),
  createTag: (repo, params) => repo.createTag(params),
  deleteTag: (repo, params) => repo.deleteTag(params),
  pushTag: (repo, params) => repo.pushTag(params),
  merge: (repo, params) => repo.merge(params),
  rebase: (repo, params) => repo.rebase(params),
  cherryPick: (repo, params) => repo.cherryPick(params),
  revert: (repo, params) => repo.revert(params),
  reset: (repo, params) => repo.reset(params),
  continueOperation: (repo) => repo.continueOperation(),
  abortOperation: (repo) => repo.abortOperation(),
  remotes: (repo) => repo.remotes(),
  addRemote: (repo, params) => repo.addRemote(params),
  removeRemote: (repo, params) => repo.removeRemote(params),
  fetch: (repo) => repo.fetch(),
  pull: (repo, params) => repo.pull(params),
  push: (repo, params) => repo.push(params),
  stashList: (repo) => repo.stashList(),
  stash: (repo, params) => repo.stash(params),
  stashApply: (repo, params) => repo.stashApply(params),
  stashDrop: (repo, params) => repo.stashDrop(params),
  stashDetails: (repo, params) => repo.stashDetails(params),
  log: (repo, params) => repo.log(params),
  commitDetails: (repo, params) => repo.commitDetails(params),
  readFile: (repo, params) => repo.readFile(params),
  diff: (repo, params) => repo.diff(params),
};

export function isLocalOrigin(origin) {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      isLocalHostName(url.hostname)
    );
  } catch (error) {
    return false;
  }
}

function isLocalHostName(hostName) {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostName.toLowerCase());
}

// The Host header guards against DNS rebinding: a remote page whose host name
// resolves to 127.0.0.1 still sends its own host name here.
export function isLocalHostHeader(host) {
  if (!host) {
    return false;
  }
  const hostName = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : host.split(":")[0];
  return isLocalHostName(hostName);
}

export function createBridgeServer({ root, allowedOrigins = [], log = () => {} }) {
  const extraOrigins = new Set(
    allowedOrigins.map((origin) => origin.replace(/\/$/, ""))
  );
  const isAllowedOrigin = (origin) => isLocalOrigin(origin) || extraOrigins.has(origin);

  return http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (!isLocalHostHeader(request.headers.host)) {
      sendJSON(response, 403, { ok: false, error: "forbidden host" });
      return;
    }
    if (origin !== undefined && !isAllowedOrigin(origin)) {
      sendJSON(response, 403, { ok: false, error: `origin not allowed: ${origin}` });
      return;
    }
    if (origin !== undefined) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }

    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Methods", "POST, GET");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.setHeader("Access-Control-Max-Age", "600");
      if (request.headers["access-control-request-private-network"]) {
        response.setHeader("Access-Control-Allow-Private-Network", "true");
      }
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url, "http://localhost");
    if (
      request.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/api/ping")
    ) {
      sendJSON(response, 200, {
        ok: true,
        result: { name: BRIDGE_NAME, version: BRIDGE_VERSION, root },
      });
      return;
    }

    const match = url.pathname.match(/^\/api\/([A-Za-z]+)$/);
    if (request.method !== "POST" || !match || !Object.hasOwn(COMMANDS, match[1])) {
      sendJSON(response, 404, { ok: false, error: "unknown command" });
      return;
    }
    // Requiring JSON makes every browser request a CORS preflighted one
    if (!String(request.headers["content-type"]).startsWith("application/json")) {
      sendJSON(response, 415, { ok: false, error: "expected application/json" });
      return;
    }

    const command = match[1];
    const started = Date.now();
    try {
      const params = await readJSONBody(request);
      const { project, ...rest } = params;
      const { workDir } = resolveProject(root, project);
      const repo = await Repository.open(workDir);
      const result = await COMMANDS[command](repo, rest);
      sendJSON(response, 200, { ok: true, result: result ?? null });
      log(`${command} ${Date.now() - started}ms`);
    } catch (error) {
      const known =
        error instanceof GitError ||
        error instanceof RequestError ||
        error instanceof ProjectError;
      if (!known) {
        console.error(error);
      }
      log(`${command} failed: ${error.message}`);
      sendJSON(response, known ? 400 : 500, {
        ok: false,
        error: error.message,
        stderr: error.stderr || undefined,
      });
    }
  });
}

function readJSONBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new RequestError("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          throw new Error();
        }
        resolve(body);
      } catch (error) {
        reject(new RequestError("invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function sendJSON(response, statusCode, data) {
  const body = JSON.stringify(data);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}
