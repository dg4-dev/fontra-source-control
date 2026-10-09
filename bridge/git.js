// Runs git as a child process. Arguments are passed as an array (no shell), and
// git never gets a terminal to ask for credentials on: a push or pull that needs
// a password fails with an error instead of hanging.

import { spawn } from "node:child_process";

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60 * 1000;
export const NETWORK_TIMEOUT_MS = 5 * 60 * 1000;

export class GitError extends Error {
  constructor(message, { code = null, stderr = "", stdout = "", args = [] } = {}) {
    super(message);
    this.name = "GitError";
    this.code = code;
    this.stderr = stderr;
    this.stdout = stdout;
    this.args = args;
  }
}

export function gitEnvironment(extra = {}) {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    // Plain English messages keep the output parseable and the errors readable
    LC_ALL: "C",
    LANGUAGE: "C",
    // Never open an editor: commit messages are always given on the command line
    GIT_EDITOR: "true",
    GIT_SEQUENCE_EDITOR: "true",
    GIT_MERGE_AUTOEDIT: "no",
    ...extra,
  };
}

// Runs git and resolves with { code, stdout, stderr }. stdout is a Buffer when
// options.binary is set, a string otherwise. Rejects with GitError when git
// exits with a code that is not in options.okCodes (default [0]).
export function runGit(args, options = {}) {
  const {
    cwd,
    input = null,
    binary = false,
    okCodes = [0],
    timeout = DEFAULT_TIMEOUT_MS,
    env = {},
  } = options;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn("git", args, {
        cwd,
        env: gitEnvironment(env),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      reject(new GitError(`could not run git: ${error.message}`, { args }));
      return;
    }
    const stdoutChunks = [];
    const stderrChunks = [];
    let outputBytes = 0;
    let killedReason = null;

    const timer = setTimeout(() => {
      killedReason = `git ${args[0]} timed out after ${Math.round(timeout / 1000)}s`;
      child.kill();
    }, timeout);

    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        killedReason = `git ${args[0]} produced more than ${MAX_OUTPUT_BYTES} bytes`;
        child.kill();
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      const message =
        error.code === "ENOENT"
          ? "git was not found. Install git and make sure it is on the PATH."
          : `could not run git: ${error.message}`;
      reject(new GitError(message, { args }));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const stdout = binary ? stdoutBuffer : stdoutBuffer.toString("utf8");
      if (killedReason) {
        reject(new GitError(killedReason, { code, stderr, args }));
        return;
      }
      if (!okCodes.includes(code)) {
        const firstLine =
          stderr.trim().split("\n").filter(Boolean).slice(-3).join("\n") ||
          `git ${args[0]} failed with exit code ${code}`;
        reject(
          new GitError(firstLine, {
            code,
            stderr,
            stdout: binary ? "" : stdout,
            args,
          })
        );
        return;
      }
      resolve({ code, stdout, stderr });
    });
    child.stdin.on("error", () => {
      // git may exit before reading stdin; the exit code tells what happened
    });
    if (input !== null) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}
