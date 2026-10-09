// Git operations with their dialogs and messages, shared by the sidebar
// panel, the menu bar menu and the graph view.

import { t } from "./strings.js";
import { confirmDialog, showDialog, showToast } from "./ui/dom.js";

export class GitActions {
  constructor(state, settings) {
    this.state = state;
    this.settings = settings;
    this.client = state.client;
  }

  // Runs a command; shows failures as a toast and returns undefined then
  async run(command, params, label, successMessage = null) {
    try {
      const result = await this.state.run(command, params, label);
      if (result?.conflicts) {
        showToast(t("message.conflicts"), "error");
      } else if (successMessage) {
        showToast(successMessage, "success");
      }
      return result ?? true;
    } catch (error) {
      showError(error);
      return undefined;
    }
  }

  async refs() {
    try {
      return await this.client.call("refs");
    } catch (error) {
      showError(error);
      return null;
    }
  }

  // --- repository ------------------------------------------------------------

  async init() {
    const folder = this.state.status?.workDir ?? "";
    const values = await showDialog({
      title: t("action.init"),
      message: t("dialog.init.message"),
      detail: folder,
      fields: [
        { key: "branch", type: "text", label: t("dialog.init.branch"), value: "main" },
      ],
      okLabel: t("action.init"),
    });
    if (!values) {
      return;
    }
    await this.run("init", { initialBranch: values.branch.trim() }, t("action.init"));
  }

  // --- committing --------------------------------------------------------------

  async commit(message, { amend = false } = {}) {
    const status = this.state.status;
    if (!status?.initialized) {
      return false;
    }
    if (!amend && !message.trim()) {
      showToast(t("message.enterCommitMessage"), "error");
      return false;
    }
    if (status.conflicts.length) {
      showToast(t("message.resolveConflictsFirst"), "error");
      return false;
    }
    let all = false;
    if (!amend && !status.staged.length) {
      const changes = status.unstaged.length + status.untracked.length;
      if (!changes && status.operation !== "merge") {
        showToast(t("message.nothingToCommit"), "error");
        return false;
      }
      if (changes) {
        const ok = await confirmDialog({
          title: t("dialog.commitAll.title"),
          message: t("dialog.commitAll.message"),
          okLabel: t("dialog.commitAll.ok"),
        });
        if (!ok) {
          return false;
        }
        all = true;
      }
    }
    const result = await this.run(
      "commit",
      { message, amend, all },
      t("action.commit"),
      amend ? t("message.amended") : t("message.committed")
    );
    return !!result;
  }

  async continueOperation() {
    await this.run("continueOperation", {}, t("action.continue"));
  }

  async abortOperation() {
    const operation = this.state.status?.operation;
    const ok = await confirmDialog({
      title: t("action.abort"),
      message: t("dialog.abort.message", { operation: operationLabel(operation) }),
      okLabel: t("action.abort"),
      danger: true,
    });
    if (ok) {
      await this.run("abortOperation", {}, t("action.abort"));
    }
  }

  // --- staging -------------------------------------------------------------------

  stage(paths) {
    return this.run("stage", { paths }, t("action.stage"));
  }

  unstage(paths) {
    return this.run("unstage", { paths }, t("action.unstage"));
  }

  stageAll() {
    return this.run("stageAll", {}, t("action.stageAll"));
  }

  unstageAll() {
    return this.run("unstageAll", {}, t("action.unstageAll"));
  }

  async discard(paths) {
    const ok = await confirmDialog({
      title: t("action.discard"),
      message:
        paths.length === 1
          ? t("dialog.discard.one", { path: paths[0] })
          : t("dialog.discard.many", { count: paths.length }),
      okLabel: t("action.discard"),
      danger: true,
    });
    if (ok) {
      await this.run("discard", { paths }, t("action.discard"));
    }
  }

  // --- remotes -------------------------------------------------------------------

  pull() {
    return this.run(
      "pull",
      { mode: this.settings.get("pullMode") },
      t("action.pull"),
      t("message.pulled")
    );
  }

  async push({ force = false } = {}) {
    if (force) {
      const ok = await confirmDialog({
        title: t("action.forcePush"),
        message: t("dialog.forcePush.message"),
        okLabel: t("action.forcePush"),
        danger: true,
      });
      if (!ok) {
        return;
      }
    }
    const status = this.state.status;
    if (status?.initialized && !status.remotes.length) {
      const added = await this.addRemote();
      if (!added) {
        return;
      }
    }
    return this.run("push", { force }, t("action.push"), t("message.pushed"));
  }

  fetch() {
    return this.run("fetch", {}, t("action.fetch"), t("message.fetched"));
  }

  async sync() {
    const result = await this.pull();
    if (result && !result.conflicts) {
      await this.push();
    }
  }

  async addRemote() {
    const values = await showDialog({
      title: t("action.addRemote"),
      fields: [
        { key: "name", type: "text", label: t("dialog.remote.name"), value: "origin" },
        {
          key: "url",
          type: "text",
          label: t("dialog.remote.url"),
          placeholder: "https://github.com/user/repo.git",
        },
      ],
      okLabel: t("action.addRemote"),
      validate: (v) => (!v.name.trim() || !v.url.trim() ? t("dialog.required") : null),
    });
    if (!values) {
      return false;
    }
    return !!(await this.run(
      "addRemote",
      { name: values.name.trim(), url: values.url.trim() },
      t("action.addRemote")
    ));
  }

  async removeRemote() {
    const status = this.state.status;
    const remotes = status?.remotes ?? [];
    if (!remotes.length) {
      showToast(t("message.noRemotes"), "error");
      return;
    }
    const values = await showDialog({
      title: t("action.removeRemote"),
      fields: [
        {
          key: "name",
          type: "select",
          label: t("dialog.remote.name"),
          options: remotes.map((name) => ({ value: name })),
        },
      ],
      okLabel: t("action.removeRemote"),
      danger: true,
    });
    if (values) {
      await this.run("removeRemote", { name: values.name }, t("action.removeRemote"));
    }
  }

  // --- branches --------------------------------------------------------------------

  async createBranch(startPoint = null) {
    const values = await showDialog({
      title: t("action.createBranch"),
      message: startPoint ? t("dialog.branch.from", { ref: shortRef(startPoint) }) : "",
      fields: [
        {
          key: "name",
          type: "text",
          label: t("dialog.branch.name"),
          placeholder: "feature/…",
        },
        {
          key: "checkout",
          type: "checkbox",
          label: t("dialog.branch.checkout"),
          value: true,
        },
      ],
      okLabel: t("action.createBranch"),
      validate: (v) => (!v.name.trim() ? t("dialog.required") : null),
    });
    if (!values) {
      return;
    }
    await this.run(
      "createBranch",
      { name: values.name.trim(), startPoint, checkout: values.checkout },
      t("action.createBranch")
    );
  }

  async switchBranch() {
    const data = await this.refs();
    if (!data) {
      return;
    }
    const local = data.refs.filter((ref) => ref.type === "head");
    const remote = data.refs.filter(
      (ref) =>
        ref.type === "remote" &&
        !local.some((head) => head.name === ref.name.slice(ref.name.indexOf("/") + 1))
    );
    const options = [
      ...local.map((ref) => ({
        value: `branch:${ref.name}`,
        label:
          ref.name +
          (ref.name === data.currentBranch ? ` (${t("label.current")})` : ""),
      })),
      ...remote.map((ref) => ({ value: `remote:${ref.name}`, label: ref.name })),
    ];
    if (!options.length) {
      showToast(t("message.noBranches"), "error");
      return;
    }
    const values = await showDialog({
      title: t("action.switchBranch"),
      fields: [
        {
          key: "ref",
          type: "select",
          label: t("dialog.branch.select"),
          options,
          value: `branch:${data.currentBranch}`,
        },
      ],
      okLabel: t("action.switch"),
    });
    if (!values) {
      return;
    }
    const [kind, ...rest] = values.ref.split(":");
    await this.checkout(rest.join(":"), kind);
  }

  checkout(ref, kind = "branch") {
    return this.run("checkout", { ref, kind }, t("action.switch"));
  }

  async checkoutCommit(hash) {
    const ok = await confirmDialog({
      title: t("action.checkoutCommit"),
      message: t("dialog.detached.message", { ref: hash.slice(0, 8) }),
      okLabel: t("action.checkoutCommit"),
    });
    if (ok) {
      await this.checkout(hash, "commit");
    }
  }

  async mergeBranch(ref = null) {
    if (!ref) {
      const data = await this.refs();
      if (!data) {
        return;
      }
      const options = data.refs
        .filter(
          (r) =>
            (r.type === "head" || r.type === "remote") && r.name !== data.currentBranch
        )
        .map((r) => ({ value: r.name }));
      if (!options.length) {
        showToast(t("message.noBranches"), "error");
        return;
      }
      const values = await showDialog({
        title: t("action.merge"),
        fields: [
          { key: "ref", type: "select", label: t("dialog.merge.select"), options },
          {
            key: "noFF",
            type: "checkbox",
            label: t("dialog.merge.noFF"),
            value: this.settings.get("mergeNoFastForward"),
          },
          {
            key: "squash",
            type: "checkbox",
            label: t("dialog.merge.squash"),
            value: false,
          },
        ],
        okLabel: t("action.merge"),
      });
      if (!values) {
        return;
      }
      this.settings.set("mergeNoFastForward", values.noFF);
      return this.run(
        "merge",
        { ref: values.ref, noFastForward: values.noFF, squash: values.squash },
        t("action.merge"),
        t("message.merged")
      );
    }
    const values = await showDialog({
      title: t("action.merge"),
      message: t("dialog.merge.confirm", {
        ref: shortRef(ref),
        branch: this.state.status?.branch?.head ?? "HEAD",
      }),
      fields: [
        {
          key: "noFF",
          type: "checkbox",
          label: t("dialog.merge.noFF"),
          value: this.settings.get("mergeNoFastForward"),
        },
        {
          key: "squash",
          type: "checkbox",
          label: t("dialog.merge.squash"),
          value: false,
        },
      ],
      okLabel: t("action.merge"),
    });
    if (!values) {
      return;
    }
    this.settings.set("mergeNoFastForward", values.noFF);
    return this.run(
      "merge",
      { ref, noFastForward: values.noFF, squash: values.squash },
      t("action.merge"),
      t("message.merged")
    );
  }

  async rebaseOnto(ref) {
    const ok = await confirmDialog({
      title: t("action.rebase"),
      message: t("dialog.rebase.message", {
        ref: shortRef(ref),
        branch: this.state.status?.branch?.head ?? "HEAD",
      }),
      okLabel: t("action.rebase"),
    });
    if (ok) {
      await this.run("rebase", { ref }, t("action.rebase"));
    }
  }

  async deleteBranch(name) {
    const ok = await confirmDialog({
      title: t("action.deleteBranch"),
      message: t("dialog.deleteBranch.message", { name }),
      okLabel: t("action.deleteBranch"),
      danger: true,
    });
    if (!ok) {
      return;
    }
    try {
      await this.state.run(
        "deleteBranch",
        { name, force: false },
        t("action.deleteBranch")
      );
    } catch (error) {
      if (!/not fully merged/i.test(error.message)) {
        showError(error);
        return;
      }
      const force = await confirmDialog({
        title: t("action.deleteBranch"),
        message: t("dialog.deleteBranch.unmerged", { name }),
        okLabel: t("action.deleteBranch"),
        danger: true,
      });
      if (force) {
        await this.run("deleteBranch", { name, force: true }, t("action.deleteBranch"));
      }
    }
  }

  async deleteRemoteBranch(name) {
    const ok = await confirmDialog({
      title: t("action.deleteRemoteBranch"),
      message: t("dialog.deleteRemoteBranch.message", { name }),
      okLabel: t("action.deleteRemoteBranch"),
      danger: true,
    });
    if (ok) {
      await this.run("deleteRemoteBranch", { name }, t("action.deleteRemoteBranch"));
    }
  }

  async renameBranch(name) {
    const values = await showDialog({
      title: t("action.renameBranch"),
      fields: [
        { key: "name", type: "text", label: t("dialog.branch.name"), value: name },
      ],
      okLabel: t("action.renameBranch"),
      validate: (v) => (!v.name.trim() ? t("dialog.required") : null),
    });
    if (values && values.name.trim() !== name) {
      await this.run(
        "renameBranch",
        { name, newName: values.name.trim() },
        t("action.renameBranch")
      );
    }
  }

  // --- tags --------------------------------------------------------------------------

  async createTag(ref) {
    const values = await showDialog({
      title: t("action.createTag"),
      message: t("dialog.tag.at", { ref: shortRef(ref) }),
      fields: [
        {
          key: "name",
          type: "text",
          label: t("dialog.tag.name"),
          placeholder: "v1.0.0",
        },
        { key: "message", type: "textarea", label: t("dialog.tag.message") },
      ],
      okLabel: t("action.createTag"),
      validate: (v) => (!v.name.trim() ? t("dialog.required") : null),
    });
    if (values) {
      await this.run(
        "createTag",
        { name: values.name.trim(), ref, message: values.message },
        t("action.createTag")
      );
    }
  }

  async deleteTag(name) {
    const ok = await confirmDialog({
      title: t("action.deleteTag"),
      message: t("dialog.deleteTag.message", { name }),
      okLabel: t("action.deleteTag"),
      danger: true,
    });
    if (ok) {
      await this.run("deleteTag", { name }, t("action.deleteTag"));
    }
  }

  pushTag(name) {
    return this.run("pushTag", { name }, t("action.pushTag"), t("message.pushed"));
  }

  // --- commits ---------------------------------------------------------------------------

  async cherryPick(hash) {
    const ok = await confirmDialog({
      title: t("action.cherryPick"),
      message: t("dialog.cherryPick.message", {
        ref: hash.slice(0, 8),
        branch: this.state.status?.branch?.head ?? "HEAD",
      }),
      okLabel: t("action.cherryPick"),
    });
    if (ok) {
      await this.run("cherryPick", { hash }, t("action.cherryPick"));
    }
  }

  async revert(hash) {
    const ok = await confirmDialog({
      title: t("action.revert"),
      message: t("dialog.revert.message", { ref: hash.slice(0, 8) }),
      okLabel: t("action.revert"),
    });
    if (ok) {
      await this.run("revert", { hash }, t("action.revert"));
    }
  }

  async reset(hash) {
    const values = await showDialog({
      title: t("action.reset"),
      message: t("dialog.reset.message", {
        ref: hash.slice(0, 8),
        branch: this.state.status?.branch?.head ?? "HEAD",
      }),
      fields: [
        {
          key: "mode",
          type: "select",
          label: t("dialog.reset.mode"),
          value: "mixed",
          options: [
            { value: "soft", label: t("dialog.reset.soft") },
            { value: "mixed", label: t("dialog.reset.mixed") },
            { value: "hard", label: t("dialog.reset.hard") },
          ],
        },
      ],
      okLabel: t("action.reset"),
      danger: true,
    });
    if (!values) {
      return;
    }
    if (values.mode === "hard") {
      const ok = await confirmDialog({
        title: t("action.reset"),
        message: t("dialog.reset.hardConfirm"),
        okLabel: t("action.reset"),
        danger: true,
      });
      if (!ok) {
        return;
      }
    }
    await this.run("reset", { hash, mode: values.mode }, t("action.reset"));
  }

  // --- stashes ------------------------------------------------------------------------------

  async stash() {
    const values = await showDialog({
      title: t("action.stash"),
      fields: [
        { key: "message", type: "text", label: t("dialog.stash.message") },
        {
          key: "includeUntracked",
          type: "checkbox",
          label: t("dialog.stash.untracked"),
          value: true,
        },
      ],
      okLabel: t("action.stash"),
    });
    if (values) {
      await this.run("stash", values, t("action.stash"), t("message.stashed"));
    }
  }

  stashApply(index, pop) {
    return this.run(
      "stashApply",
      { index, pop },
      pop ? t("action.stashPop") : t("action.stashApply")
    );
  }

  async stashDrop(index) {
    const ok = await confirmDialog({
      title: t("action.stashDrop"),
      message: t("dialog.stashDrop.message", { index }),
      okLabel: t("action.stashDrop"),
      danger: true,
    });
    if (ok) {
      await this.run("stashDrop", { index }, t("action.stashDrop"));
    }
  }

  // --- settings --------------------------------------------------------------------------------

  async bridgeSettings() {
    const values = await showDialog({
      title: t("action.bridgeSettings"),
      message: t("dialog.bridge.message"),
      fields: [
        {
          key: "bridgeUrl",
          type: "text",
          label: t("dialog.bridge.url"),
          value: this.settings.get("bridgeUrl"),
        },
        {
          key: "pullMode",
          type: "select",
          label: t("dialog.bridge.pullMode"),
          value: this.settings.get("pullMode"),
          options: [
            { value: "merge", label: t("dialog.pull.merge") },
            { value: "rebase", label: t("dialog.pull.rebase") },
            { value: "ff-only", label: t("dialog.pull.ffOnly") },
          ],
        },
        {
          key: "autoRefresh",
          type: "checkbox",
          label: t("dialog.bridge.autoRefresh"),
          value: this.settings.get("autoRefresh"),
        },
      ],
      okLabel: t("dialog.save"),
    });
    if (!values) {
      return;
    }
    for (const [key, value] of Object.entries(values)) {
      this.settings.set(key, value);
    }
    await this.state.refresh();
  }
}

export function showError(error) {
  const detail =
    error.stderr && error.stderr.trim() !== error.message
      ? `\n${error.stderr.trim()}`
      : "";
  showToast(`${error.message}${detail}`.slice(0, 1200), "error");
  console.error("[source-control]", error);
}

export function operationLabel(operation) {
  return operation ? t(`operation.${operation}`) : "";
}

function shortRef(ref) {
  return /^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 8) : ref;
}
