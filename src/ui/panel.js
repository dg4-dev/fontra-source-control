// The Source Control panel in the glyph editor's left sidebar, modeled on VS
// Code's Source Control view: branch, commit message, staged and unstaged
// changes, conflicts and stashes. Clicking a file opens the diff view.

import { operationLabel } from "../git-actions.js";
import { t } from "../strings.js";
import {
  baseCSS,
  el,
  formatRelativeTime,
  icon,
  iconButton,
  isolateKeyboard,
  showMenu,
  showToast,
  splitPath,
} from "./dom.js";

export const PANEL_IDENTIFIER = "source-control";
const BRIDGE_COMMAND = "npx --yes github:dg4-dev/fontra-source-control";
const SETUP_GUIDE_URL = "https://github.com/dg4-dev/fontra-source-control#setup";
const ELEMENT_NAME = "fontra-source-control-panel";

const styles = `
  ${baseCSS}
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: transparent;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 0.2em;
    padding: 0.7em 0.6em 0.4em 1em;
  }
  .header .title {
    flex: 1;
    font-weight: bold;
    letter-spacing: 0.02em;
  }
  .body {
    flex: 1;
    overflow: hidden auto;
    padding: 0 0.6em 1em;
    display: flex;
    flex-direction: column;
    gap: 0.6em;
  }
  .slot {
    display: flex;
    flex-direction: column;
    gap: 0.6em;
  }
  .slot:empty {
    display: none;
  }
  textarea[hidden] {
    display: none;
  }
  .notice {
    display: flex;
    flex-direction: column;
    gap: 0.6em;
    padding: 0.4em 0.4em;
    line-height: 1.45;
  }
  .notice .link {
    color: inherit;
  }
  .notice code, .notice .path {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9em;
    background: var(--sc-surface-alt);
    border-radius: 0.3em;
    padding: 0.4em 0.5em;
    word-break: break-all;
    user-select: all;
  }
  .branch-row {
    display: flex;
    align-items: center;
    gap: 0.3em;
  }
  .branch-button {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.4em;
    padding: 0.3em 0.4em;
    border: none;
    border-radius: 0.35em;
    background: none;
    cursor: pointer;
    text-align: left;
  }
  .branch-button:hover {
    background: var(--sc-hover);
  }
  .branch-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: bold;
  }
  .ahead-behind {
    font-size: 0.85em;
    color: var(--sc-muted);
    white-space: nowrap;
  }
  .banner {
    display: flex;
    flex-direction: column;
    gap: 0.4em;
    padding: 0.55em 0.6em;
    border-radius: 0.4em;
    background: var(--sc-removed-background);
  }
  .banner .actions {
    display: flex;
    gap: 0.4em;
  }
  textarea.message {
    width: 100%;
    min-height: 3.6em;
    resize: vertical;
    line-height: 1.35;
  }
  .commit-row {
    display: flex;
    gap: 1px;
  }
  .commit-row .button.primary:first-child {
    flex: 1;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .commit-row .button.primary:last-child {
    padding: 0.35em 0.45em;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .commit-row .icon.down svg {
    transform: rotate(90deg);
  }
  .busy {
    font-size: 0.9em;
    color: var(--sc-muted);
  }
  .section-header {
    display: flex;
    align-items: center;
    gap: 0.2em;
    padding: 0.15em 0.1em;
    border-radius: 0.35em;
    cursor: pointer;
    user-select: none;
  }
  .section-header:hover {
    background: var(--sc-hover);
  }
  .section-header .chevron svg {
    transition: transform 0.1s;
  }
  .section-header.open .chevron svg {
    transform: rotate(90deg);
  }
  .section-header .label {
    flex: 1;
    font-weight: bold;
    font-size: 0.92em;
  }
  .count {
    min-width: 1.6em;
    padding: 0 0.45em;
    border-radius: 1em;
    background: var(--sc-surface-alt);
    font-size: 0.8em;
    text-align: center;
  }
  .section-header .icon-button,
  .file-row .icon-button {
    visibility: hidden;
  }
  .section-header:hover .icon-button,
  .file-row:hover .icon-button,
  .file-row:focus-within .icon-button {
    visibility: visible;
  }
  .files {
    display: flex;
    flex-direction: column;
  }
  .file-row {
    display: flex;
    align-items: center;
    gap: 0.35em;
    padding: 0.12em 0.15em 0.12em 1.3em;
    border-radius: 0.35em;
    cursor: pointer;
  }
  .file-row:hover {
    background: var(--sc-hover);
  }
  .file-row .name {
    white-space: nowrap;
  }
  .file-row .dir {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
    font-size: 0.85em;
    color: var(--sc-muted);
  }
  .file-row.deleted .name {
    text-decoration: line-through;
  }
  .stash-row {
    display: flex;
    align-items: center;
    gap: 0.35em;
    padding: 0.15em 0.15em 0.15em 1.3em;
    border-radius: 0.35em;
    cursor: pointer;
  }
  .stash-row:hover {
    background: var(--sc-hover);
  }
  .stash-row .subject {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stash-row .icon-button {
    visibility: hidden;
  }
  .stash-row:hover .icon-button {
    visibility: visible;
  }
  .empty {
    padding: 0.2em 1.3em;
    color: var(--sc-muted);
    font-size: 0.92em;
  }
`;

export function definePanelElement() {
  const existing = customElements.get(ELEMENT_NAME);
  if (existing) {
    return existing;
  }

  class SourceControlPanel extends HTMLElement {
    constructor({ state, actions, iconPath, openDiff, openGraph, openStash }) {
      super();
      this.identifier = PANEL_IDENTIFIER;
      this.iconPath = iconPath;
      this.state = state;
      this.actions = actions;
      this.openDiff = openDiff;
      this.openGraph = openGraph;
      this.openStash = openStash;
      this.collapsed = new Set(["stashes"]);
      this.stashes = [];
      this.visible = false;
      this.attachShadow({ mode: "open" });
      isolateKeyboard(this.shadowRoot);
      this._build();
      this._onState = () => this._update();
      state.addListener(this._onState);
    }

    // Called by Fontra when the sidebar tab is opened or closed
    async toggle(on, focus) {
      if (on && !this.visible) {
        this.visible = true;
        this.state.retain();
      } else if (!on && this.visible) {
        this.visible = false;
        this.state.release();
      }
      if (on && focus) {
        this.messageInput.focus();
      }
    }

    focusMessage() {
      this.messageInput.focus();
    }

    _build() {
      const style = document.createElement("style");
      style.textContent = styles;
      this.messageInput = el("textarea", {
        class: "message",
        placeholder: t("panel.messagePlaceholder"),
        spellcheck: "true",
        onkeydown: (event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            this._commit();
          }
        },
      });
      this.bodyElement = el("div", { class: "body" });
      this.topSlot = el("div", { class: "slot" });
      this.listSlot = el("div", { class: "slot" });
      this.shadowRoot.append(
        style,
        el(
          "div",
          { class: "header" },
          el("span", { class: "title" }, t("panel.title")),
          iconButton("graph", t("action.openGraph"), () => this.openGraph()),
          iconButton("refresh", t("action.refresh"), () => this.state.refresh()),
          iconButton("more", t("action.more"), (event) =>
            this._showMoreMenu(event.currentTarget)
          )
        ),
        this.bodyElement
      );
      this._update();
    }

    _update() {
      const state = this.state;
      const status = state.status;
      const scrollTop = this.bodyElement.scrollTop;
      const repository = state.connection !== "unreachable" && !!status?.initialized;
      // The message box stays in place across updates so typing is never
      // interrupted; everything else is rebuilt.
      if (!this.messageInput.isConnected) {
        this.bodyElement.append(this.topSlot, this.messageInput, this.listSlot);
      }
      this.messageInput.hidden = !repository;
      let top;
      let list = [];
      if (state.connection === "unreachable") {
        top = this._renderUnreachable();
      } else if (!status && state.lastError) {
        top = this._renderBridgeError();
      } else if (!status) {
        top = [el("div", { class: "notice muted" }, t("panel.loading"))];
      } else if (!status.initialized) {
        top = this._renderNotRepository(status);
      } else {
        ({ top, list } = this._renderRepository(status));
      }
      this.topSlot.replaceChildren(...top.filter(Boolean));
      this.listSlot.replaceChildren(...list.filter(Boolean));
      this.bodyElement.scrollTop = scrollTop;
      if (status?.initialized && this.visible) {
        this._loadStashes(status.stashCount);
      }
    }

    _renderUnreachable() {
      return [
        el(
          "div",
          { class: "notice" },
          el("strong", {}, t("panel.unreachable.title")),
          el(
            "span",
            {},
            t("panel.unreachable.message", { url: this.state.client.url })
          ),
          el("code", {}, BRIDGE_COMMAND),
          el("span", { class: "muted" }, t("panel.unreachable.hint")),
          el(
            "div",
            { class: "branch-row" },
            el(
              "button",
              {
                class: "button",
                type: "button",
                onclick: () => copyText(BRIDGE_COMMAND),
              },
              t("action.copyCommand")
            ),
            el(
              "button",
              { class: "button", type: "button", onclick: () => this.state.refresh() },
              t("action.retry")
            )
          ),
          el(
            "a",
            { class: "link", href: SETUP_GUIDE_URL, target: "_blank", rel: "noopener" },
            t("panel.setupGuide")
          )
        ),
      ];
    }

    // The bridge answered, but could not work with this font
    _renderBridgeError() {
      return [
        el(
          "div",
          { class: "notice" },
          el("strong", {}, t("panel.error.title")),
          el("code", {}, this.state.lastError),
          el(
            "div",
            { class: "branch-row" },
            el(
              "button",
              { class: "button", type: "button", onclick: () => this.state.refresh() },
              t("action.retry")
            ),
            el(
              "button",
              {
                class: "button",
                type: "button",
                onclick: () => this.actions.bridgeSettings(),
              },
              t("action.bridgeSettings")
            )
          )
        ),
      ];
    }

    _renderNotRepository(status) {
      return [
        el(
          "div",
          { class: "notice" },
          el("span", {}, t("panel.notRepository")),
          el("div", { class: "path" }, status.workDir),
          el(
            "button",
            {
              class: "button primary",
              type: "button",
              disabled: !!this.state.busy,
              onclick: () => this.actions.init(),
            },
            t("action.init")
          )
        ),
      ];
    }

    // Returns the parts above the message box (top) and below it (list)
    _renderRepository(status) {
      const top = [this._renderBranchRow(status)];
      if (status.operation) {
        top.push(this._renderOperationBanner(status));
      }
      const list = [this._renderCommitRow(status)];
      if (this.state.busy) {
        list.push(el("div", { class: "busy" }, `${this.state.busy}…`));
      }
      if (status.conflicts.length) {
        list.push(
          this._renderSection({
            key: "conflicts",
            label: t("panel.section.conflicts"),
            files: status.conflicts.map((change) => ({ ...change, kind: "conflict" })),
            actions: [],
          })
        );
      }
      list.push(
        this._renderSection({
          key: "staged",
          label: t("panel.section.staged"),
          files: status.staged.map((change) => ({ ...change, kind: "staged" })),
          actions: [
            status.staged.length &&
              iconButton("minus", t("action.unstageAll"), () =>
                this.actions.unstageAll()
              ),
          ],
          hideWhenEmpty: true,
        })
      );
      const unstaged = [
        ...status.unstaged.map((change) => ({ ...change, kind: "unstaged" })),
        ...status.untracked.map((change) => ({ ...change, kind: "untracked" })),
      ].sort((a, b) => a.path.localeCompare(b.path));
      list.push(
        this._renderSection({
          key: "changes",
          label: t("panel.section.changes"),
          files: unstaged,
          actions: [
            unstaged.length &&
              iconButton("discard", t("action.discardAll"), () =>
                this.actions.discard(unstaged.map((change) => change.path))
              ),
            unstaged.length &&
              iconButton("plus", t("action.stageAll"), () => this.actions.stageAll()),
          ],
        })
      );
      if (status.stashCount) {
        list.push(this._renderStashes(status));
      }
      return { top, list };
    }

    _renderBranchRow(status) {
      const branch = status.branch;
      const name =
        branch.head ??
        (branch.oid ? `${branch.oid.slice(0, 8)} (${t("label.detached")})` : "—");
      const aheadBehind = branch.upstream
        ? `↑${branch.ahead} ↓${branch.behind}`
        : status.remotes.length
          ? t("panel.noUpstream")
          : "";
      return el(
        "div",
        { class: "branch-row" },
        el(
          "button",
          {
            class: "branch-button",
            type: "button",
            title: branch.upstream
              ? t("panel.branchTooltip", { upstream: branch.upstream })
              : t("action.switchBranch"),
            onclick: (event) => this._showBranchMenu(event.currentTarget),
          },
          icon("branch"),
          el("span", { class: "branch-name" }, name),
          el("span", { class: "ahead-behind" }, aheadBehind)
        ),
        iconButton("pull", t("action.pull"), () => this.actions.pull(), {
          disabled: !!this.state.busy || !status.remotes.length,
        }),
        iconButton("push", t("action.push"), () => this.actions.push(), {
          disabled: !!this.state.busy || !branch.head,
        })
      );
    }

    _renderOperationBanner(status) {
      return el(
        "div",
        { class: "banner" },
        el(
          "span",
          {},
          t("panel.operationInProgress", {
            operation: operationLabel(status.operation),
          })
        ),
        el(
          "div",
          { class: "actions" },
          el(
            "button",
            {
              class: "button",
              type: "button",
              disabled: status.conflicts.length > 0,
              title: status.conflicts.length ? t("message.resolveConflictsFirst") : "",
              onclick: () => this.actions.continueOperation(),
            },
            t("action.continue")
          ),
          el(
            "button",
            {
              class: "button danger",
              type: "button",
              onclick: () => this.actions.abortOperation(),
            },
            t("action.abort")
          )
        )
      );
    }

    _renderCommitRow(status) {
      const busy = !!this.state.busy;
      return el(
        "div",
        { class: "commit-row" },
        el(
          "button",
          {
            class: "button primary",
            type: "button",
            disabled: busy,
            title: t("panel.commitTooltip"),
            onclick: () => this._commit(),
          },
          icon("check"),
          status.branch.head
            ? t("panel.commitTo", { branch: status.branch.head })
            : t("action.commit")
        ),
        el(
          "button",
          {
            "class": "button primary",
            "type": "button",
            "disabled": busy,
            "aria-label": t("action.more"),
            "onclick": (event) =>
              showMenu(
                [
                  { label: t("action.commit"), onSelect: () => this._commit() },
                  {
                    label: t("action.commitAndPush"),
                    onSelect: () => this._commit({ push: true }),
                  },
                  {
                    label: t("action.commitAndSync"),
                    onSelect: () => this._commit({ sync: true }),
                  },
                  "-",
                  {
                    label: t("action.amend"),
                    disabled: !status.hasCommits,
                    onSelect: () => this._commit({ amend: true }),
                  },
                ],
                event.currentTarget
              ),
          },
          el("span", { class: "icon down" }, icon("chevron"))
        )
      );
    }

    async _commit({ amend = false, push = false, sync = false } = {}) {
      const message = this.messageInput.value;
      const ok = await this.actions.commit(message, { amend });
      if (!ok) {
        return;
      }
      this.messageInput.value = "";
      if (sync) {
        await this.actions.sync();
      } else if (push) {
        await this.actions.push();
      }
    }

    _renderSection({ key, label, files, actions, hideWhenEmpty = false }) {
      if (hideWhenEmpty && !files.length) {
        return null;
      }
      const open = !this.collapsed.has(key);
      const header = el(
        "div",
        {
          class: `section-header${open ? " open" : ""}`,
          role: "button",
          tabindex: "0",
          onclick: () => {
            if (open) {
              this.collapsed.add(key);
            } else {
              this.collapsed.delete(key);
            }
            this._update();
          },
        },
        el("span", { class: "chevron icon" }, icon("chevron")),
        el("span", { class: "label" }, label),
        ...actions.filter(Boolean),
        el("span", { class: "count" }, String(files.length))
      );
      const list = el("div", { class: "files" });
      if (open) {
        if (!files.length) {
          list.append(el("div", { class: "empty" }, t("panel.noChanges")));
        }
        for (const file of files) {
          list.append(this._renderFileRow(file));
        }
      }
      return el("div", { class: "section" }, header, list);
    }

    _renderFileRow(file) {
      const { dir, name } = splitPath(file.path);
      const letter = statusLetter(file);
      const rowActions = [];
      if (file.kind === "staged") {
        rowActions.push(
          iconButton("minus", t("action.unstage"), () =>
            this.actions.unstage([file.path])
          )
        );
      } else if (file.kind === "conflict") {
        rowActions.push(
          iconButton("plus", t("action.markResolved"), () =>
            this.actions.stage([file.path])
          )
        );
      } else {
        rowActions.push(
          iconButton("discard", t("action.discard"), () =>
            this.actions.discard([file.path])
          ),
          iconButton("plus", t("action.stage"), () => this.actions.stage([file.path]))
        );
      }
      return el(
        "div",
        {
          class: `file-row${letter === "D" ? " deleted" : ""}`,
          title: `${file.origPath ? `${file.origPath} → ` : ""}${file.path}\n${t(
            `status.${letter === "?" ? "untracked" : letter}`
          )}`,
          tabindex: "0",
          onclick: () => this._openFile(file),
          onkeydown: (event) => {
            if (event.key === "Enter") {
              this._openFile(file);
            }
          },
          oncontextmenu: (event) => {
            event.preventDefault();
            this._showFileMenu(file, event);
          },
        },
        el(
          "span",
          { class: `status-letter status-${letter}` },
          letter === "?" ? "U" : letter
        ),
        el("span", { class: "name" }, name),
        el("span", { class: "dir" }, dir),
        ...rowActions
      );
    }

    _openFile(file) {
      this.openDiff(diffRequestForChange(file));
    }

    _showFileMenu(file, event) {
      const items = [
        { label: t("action.openDiff"), onSelect: () => this._openFile(file) },
      ];
      if (file.kind === "staged") {
        items.push({
          label: t("action.unstage"),
          onSelect: () => this.actions.unstage([file.path]),
        });
      } else if (file.kind === "conflict") {
        items.push({
          label: t("action.markResolved"),
          onSelect: () => this.actions.stage([file.path]),
        });
      } else {
        items.push(
          { label: t("action.stage"), onSelect: () => this.actions.stage([file.path]) },
          {
            label: t("action.discard"),
            danger: true,
            onSelect: () => this.actions.discard([file.path]),
          }
        );
      }
      items.push("-", {
        label: t("action.copyPath"),
        onSelect: () => copyText(file.path),
      });
      showMenu(items, event);
    }

    async _loadStashes(count) {
      if (
        count === this._stashCountLoaded &&
        this._stashRevision === this.state.revision
      ) {
        return;
      }
      this._stashCountLoaded = count;
      this._stashRevision = this.state.revision;
      if (!count) {
        this.stashes = [];
        return;
      }
      try {
        this.stashes = await this.state.client.call("stashList");
        this._update();
      } catch (error) {
        this.stashes = [];
      }
    }

    _renderStashes(status) {
      const key = "stashes";
      const open = !this.collapsed.has(key);
      const header = el(
        "div",
        {
          class: `section-header${open ? " open" : ""}`,
          role: "button",
          tabindex: "0",
          onclick: () => {
            if (open) {
              this.collapsed.add(key);
            } else {
              this.collapsed.delete(key);
            }
            this._update();
          },
        },
        el("span", { class: "chevron icon" }, icon("chevron")),
        el("span", { class: "label" }, t("panel.section.stashes")),
        el("span", { class: "count" }, String(status.stashCount))
      );
      const list = el("div", { class: "files" });
      if (open) {
        for (const stash of this.stashes) {
          list.append(
            el(
              "div",
              {
                class: "stash-row",
                title: `stash@{${stash.index}} · ${formatRelativeTime(stash.time)}`,
                onclick: (event) => this.openStash(stash, event),
              },
              icon("stash"),
              el("span", { class: "subject" }, stash.subject),
              iconButton("pull", t("action.stashApply"), () =>
                this.actions.stashApply(stash.index, false)
              ),
              iconButton("check", t("action.stashPop"), () =>
                this.actions.stashApply(stash.index, true)
              ),
              iconButton("close", t("action.stashDrop"), () =>
                this.actions.stashDrop(stash.index)
              )
            )
          );
        }
      }
      return el("div", { class: "section" }, header, list);
    }

    async _showBranchMenu(anchor) {
      const data = await this.actions.refs();
      if (!data) {
        return;
      }
      const current = data.currentBranch;
      const heads = data.refs.filter((ref) => ref.type === "head");
      const items = [
        {
          label: t("action.createBranch"),
          onSelect: () => this.actions.createBranch(),
        },
        { label: t("action.merge"), onSelect: () => this.actions.mergeBranch() },
        "-",
        { heading: t("panel.localBranches") },
        ...heads.map((ref) => ({
          label: ref.name,
          detail: ref.name === current ? t("label.current") : (ref.upstream ?? ""),
          disabled: ref.name === current,
          onSelect: () => this.actions.checkout(ref.name, "branch"),
        })),
      ];
      const remotes = data.refs.filter(
        (ref) =>
          ref.type === "remote" &&
          !heads.some((head) => head.name === ref.name.slice(ref.name.indexOf("/") + 1))
      );
      if (remotes.length) {
        items.push("-", { heading: t("panel.remoteBranches") });
        items.push(
          ...remotes.map((ref) => ({
            label: ref.name,
            onSelect: () => this.actions.checkout(ref.name, "remote"),
          }))
        );
      }
      showMenu(items, anchor);
    }

    _showMoreMenu(anchor) {
      const status = this.state.status;
      const repo = !!status?.initialized;
      const busy = !!this.state.busy;
      showMenu(
        [
          { label: t("action.openGraph"), onSelect: () => this.openGraph() },
          "-",
          {
            label: t("action.pull"),
            disabled: !repo || busy,
            onSelect: () => this.actions.pull(),
          },
          {
            label: t("action.push"),
            disabled: !repo || busy,
            onSelect: () => this.actions.push(),
          },
          {
            label: t("action.forcePush"),
            disabled: !repo || busy,
            onSelect: () => this.actions.push({ force: true }),
          },
          {
            label: t("action.fetch"),
            disabled: !repo || busy,
            onSelect: () => this.actions.fetch(),
          },
          {
            label: t("action.sync"),
            disabled: !repo || busy,
            onSelect: () => this.actions.sync(),
          },
          "-",
          {
            label: t("action.createBranch"),
            disabled: !repo || busy,
            onSelect: () => this.actions.createBranch(),
          },
          {
            label: t("action.switchBranch"),
            disabled: !repo || busy,
            onSelect: () => this.actions.switchBranch(),
          },
          {
            label: t("action.merge"),
            disabled: !repo || busy,
            onSelect: () => this.actions.mergeBranch(),
          },
          "-",
          {
            label: t("action.stash"),
            disabled: !repo || busy,
            onSelect: () => this.actions.stash(),
          },
          {
            label: t("action.stashPopLatest"),
            disabled: !repo || busy || !status?.stashCount,
            onSelect: () => this.actions.stashApply(0, true),
          },
          "-",
          {
            label: t("action.addRemote"),
            disabled: !repo || busy,
            onSelect: () => this.actions.addRemote(),
          },
          {
            label: t("action.removeRemote"),
            disabled: !repo || busy || !status?.remotes?.length,
            onSelect: () => this.actions.removeRemote(),
          },
          {
            label: t("action.init"),
            disabled: repo || !status || busy,
            onSelect: () => this.actions.init(),
          },
          "-",
          {
            label: t("action.bridgeSettings"),
            onSelect: () => this.actions.bridgeSettings(),
          },
        ],
        anchor
      );
    }
  }

  customElements.define(ELEMENT_NAME, SourceControlPanel);
  return SourceControlPanel;
}

function statusLetter(file) {
  if (file.kind === "conflict") {
    return "U";
  }
  return file.status;
}

// Which two versions to compare for a change in the working tree
export function diffRequestForChange(file) {
  switch (file.kind) {
    case "staged":
      return {
        path: file.path,
        oldPath: file.origPath ?? null,
        from: file.status === "A" ? "EMPTY" : "HEAD",
        to: file.status === "D" ? "EMPTY" : "INDEX",
        fromLabel: "HEAD",
        toLabel: t("label.index"),
        status: file.status,
      };
    case "untracked":
      return {
        path: file.path,
        from: "EMPTY",
        to: "WORKTREE",
        fromLabel: "",
        toLabel: t("label.worktree"),
        status: "?",
      };
    case "conflict":
      return {
        path: file.path,
        from: "HEAD",
        to: "WORKTREE",
        fromLabel: "HEAD",
        toLabel: t("label.worktree"),
        status: "U",
      };
    default:
      return {
        path: file.path,
        from: "INDEX",
        to: file.status === "D" ? "EMPTY" : "WORKTREE",
        fromLabel: t("label.index"),
        toLabel: t("label.worktree"),
        status: file.status,
      };
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(t("message.copied"), "success", 1500);
  } catch (error) {
    showToast(text);
  }
}
