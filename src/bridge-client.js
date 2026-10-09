// Talks to the local git bridge (bridge/cli.js) and keeps the latest
// repository status for the panel and the graph view.

export class BridgeError extends Error {
  constructor(message, { unreachable = false, stderr = "" } = {}) {
    super(message);
    this.name = "BridgeError";
    this.unreachable = unreachable;
    this.stderr = stderr;
  }
}

export class BridgeClient {
  // project: the font's path, or a promise of it. Requests wait for it.
  constructor(settings, project) {
    this.settings = settings;
    this.project = Promise.resolve(project);
  }

  get url() {
    return this.settings.get("bridgeUrl");
  }

  async call(command, params = {}) {
    const project = await this.project;
    let response;
    try {
      response = await fetch(`${this.url}/api/${command}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params, project }),
        cache: "no-store",
      });
    } catch (error) {
      throw new BridgeError(`could not reach the git bridge at ${this.url}`, {
        unreachable: true,
      });
    }
    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new BridgeError(
        `unexpected response from ${this.url} (${response.status})`,
        {
          unreachable: true,
        }
      );
    }
    if (!data.ok) {
      throw new BridgeError(data.error || `request failed (${response.status})`, {
        stderr: data.stderr ?? "",
      });
    }
    return data.result;
  }

  // Text of a file at a revision spec ("WORKTREE", "INDEX", "EMPTY", a commit),
  // or null when it does not exist there or is binary
  async readText(rev, path) {
    const file = await this.call("readFile", { rev, path });
    return file.exists && !file.binary ? file.text : null;
  }
}

const POLL_INTERVAL_MS = 3000;

// Shared, observable repository state. Views call retain() while they are
// visible so the status is polled only when someone looks at it.
export class GitState {
  constructor(client, settings) {
    this.client = client;
    this.settings = settings;
    this.status = null;
    this.connection = "unknown"; // "unknown" | "ok" | "unreachable"
    this.lastError = null;
    this.busy = null; // label of the running operation
    this.revision = 0; // bumps after every operation that changes the repository
    this._listeners = new Set();
    this._refreshPromise = null;
    this._refreshQueued = false;
    this._viewers = 0;
    this._timer = null;
    this._onFocus = () => this.refresh();
  }

  addListener(listener) {
    this._listeners.add(listener);
  }

  removeListener(listener) {
    this._listeners.delete(listener);
  }

  _notify() {
    for (const listener of this._listeners) {
      try {
        listener(this);
      } catch (error) {
        console.error("[source-control]", error);
      }
    }
  }

  retain() {
    this._viewers++;
    if (this._viewers === 1) {
      window.addEventListener("focus", this._onFocus);
      this._schedulePoll();
      this.refresh();
    }
  }

  release() {
    this._viewers = Math.max(0, this._viewers - 1);
    if (this._viewers === 0) {
      window.removeEventListener("focus", this._onFocus);
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _schedulePoll() {
    clearTimeout(this._timer);
    this._timer = setTimeout(async () => {
      if (
        this._viewers > 0 &&
        this.settings.get("autoRefresh") &&
        document.visibilityState === "visible" &&
        !this.busy
      ) {
        await this.refresh();
      }
      if (this._viewers > 0) {
        this._schedulePoll();
      }
    }, POLL_INTERVAL_MS);
  }

  // Re-reads the status. Calls made while a refresh runs are merged into one.
  refresh() {
    if (this._refreshPromise) {
      this._refreshQueued = true;
      return this._refreshPromise;
    }
    this._refreshPromise = (async () => {
      try {
        do {
          this._refreshQueued = false;
          await this._refreshOnce();
        } while (this._refreshQueued);
      } finally {
        this._refreshPromise = null;
      }
    })();
    return this._refreshPromise;
  }

  async _refreshOnce() {
    try {
      const status = await this.client.call("status");
      const changed =
        JSON.stringify(status) !== JSON.stringify(this.status) ||
        this.connection !== "ok";
      this.status = status;
      this.connection = "ok";
      this.lastError = null;
      if (changed) {
        this._notify();
      }
    } catch (error) {
      const connection = error.unreachable ? "unreachable" : "ok";
      const changed =
        connection !== this.connection || error.message !== this.lastError;
      this.connection = connection;
      this.lastError = error.message;
      if (error.unreachable) {
        this.status = null;
      }
      if (changed) {
        this._notify();
      }
    }
  }

  // Runs a bridge command that changes the repository, then refreshes.
  // Errors are rethrown for the caller to show.
  async run(command, params = {}, label = command) {
    this.busy = label;
    this._notify();
    try {
      return await this.client.call(command, params);
    } finally {
      this.busy = null;
      this.revision++;
      await this.refresh();
      this._notify();
    }
  }

  get changeCount() {
    const status = this.status;
    if (!status?.initialized) {
      return 0;
    }
    return (
      status.staged.length +
      status.unstaged.length +
      status.untracked.length +
      status.conflicts.length
    );
  }
}
