// Full-window commit graph, like the Git Graph extension for VS Code: every
// branch's history in lanes, branch and tag labels, commit details with the
// changed files (opening the diff view), and operations from context menus.

import { operationLabel } from "../git-actions.js";
import { layoutGraph } from "../graph-layout.js";
import { t } from "../strings.js";
import {
  baseCSS,
  el,
  formatDateTime,
  formatRelativeTime,
  icon,
  iconButton,
  isolateKeyboard,
  overlayZIndex,
  pushEscapeHandler,
  showMenu,
  splitPath,
  svg,
} from "./dom.js";
import { copyText, diffRequestForChange } from "./panel.js";

const PAGE_SIZE = 300;
const ROW_HEIGHT = 26;
const LANE_WIDTH = 16;
const DOT_RADIUS = 4;
const UNCOMMITTED = "*";

// Git Graph's default lane colors; readable on light and dark backgrounds
const LANE_COLORS = [
  "#0085d9",
  "#d9008f",
  "#00b30a",
  "#d98500",
  "#a300d9",
  "#e53935",
  "#00a89e",
  "#8d6e63",
];

const styles = `
  ${baseCSS}
  :host {
    position: fixed;
    inset: 0;
    z-index: ${overlayZIndex()};
    display: flex;
    flex-direction: column;
    background: var(--sc-background);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.6em;
    padding: 0.55em 0.8em 0.55em 1em;
    border-bottom: 1px solid var(--sc-border);
    flex-wrap: wrap;
  }
  .toolbar .title {
    display: inline-flex;
    align-items: center;
    gap: 0.45em;
    font-weight: bold;
    font-size: 1.1em;
  }
  .toolbar .branch {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    color: var(--sc-muted);
  }
  .toolbar .spacer {
    flex: 1;
  }
  .toolbar input[type="text"] {
    width: 14em;
  }
  .banner[hidden] {
    display: none;
  }
  .banner {
    display: flex;
    align-items: center;
    gap: 0.8em;
    padding: 0.45em 1em;
    background: var(--sc-removed-background);
  }
  .main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .table-area {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    table-layout: fixed;
  }
  th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--sc-background);
    text-align: left;
    font-size: 0.88em;
    padding: 0.4em 0.6em;
    border-bottom: 1px solid var(--sc-border);
    white-space: nowrap;
  }
  td {
    height: ${ROW_HEIGHT}px;
    padding: 0 0.6em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  td.graph {
    padding: 0 0 0 0.4em;
    overflow: visible;
  }
  td.graph svg {
    display: block;
  }
  tr.commit {
    cursor: pointer;
  }
  tr.commit:hover td {
    background: var(--sc-hover);
  }
  tr.commit.selected td {
    background: var(--sc-selected);
  }
  tr.commit.dimmed td:not(.graph) {
    opacity: 0.35;
  }
  tr.commit.head .subject {
    font-weight: bold;
  }
  tr.uncommitted .subject {
    font-style: italic;
    color: var(--sc-muted);
  }
  td.date, td.author, td.hash {
    color: var(--sc-muted);
    font-size: 0.92em;
  }
  td.hash {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .ref {
    display: inline-flex;
    align-items: center;
    gap: 0.25em;
    margin-right: 0.35em;
    padding: 0 0.45em;
    border-radius: 0.35em;
    border: 1px solid currentColor;
    font-size: 0.85em;
    line-height: 1.5;
    vertical-align: middle;
    cursor: context-menu;
  }
  .ref .icon {
    width: 0.95em;
    height: 0.95em;
  }
  .ref.current {
    font-weight: bold;
    color: var(--sc-accent-foreground);
    border-color: transparent;
  }
  .ref.remote {
    font-style: italic;
    opacity: 0.85;
  }
  .ref.tag {
    color: var(--sc-muted);
  }
  .ref.detached {
    color: var(--sc-foreground);
  }
  .more {
    padding: 0.8em;
    text-align: center;
  }
  .details {
    height: 40%;
    min-height: 12em;
    display: flex;
    border-top: 1px solid var(--sc-border);
    background: var(--sc-surface);
  }
  .details[hidden] {
    display: none;
  }
  .details .info {
    flex: 1;
    min-width: 0;
    overflow: auto;
    padding: 0.8em 1em;
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    border-right: 1px solid var(--sc-border);
  }
  .details .info h3 {
    margin: 0;
    font-size: 1.05em;
  }
  .details .body {
    white-space: pre-wrap;
    line-height: 1.45;
    word-break: break-word;
  }
  .meta {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.25em 0.8em;
    font-size: 0.92em;
  }
  .meta .key {
    color: var(--sc-muted);
  }
  .link {
    color: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-style: dotted;
  }
  .details .files {
    flex: 1;
    min-width: 0;
    overflow: auto;
    padding: 0.6em 0.5em;
  }
  .details .files h4 {
    margin: 0.1em 0.5em 0.5em;
    font-size: 0.92em;
  }
  .file-row {
    display: flex;
    align-items: center;
    gap: 0.4em;
    padding: 0.15em 0.5em;
    border-radius: 0.35em;
    cursor: pointer;
  }
  .file-row:hover {
    background: var(--sc-hover);
  }
  .file-row .dir {
    color: var(--sc-muted);
    font-size: 0.88em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .message {
    margin: auto;
    padding: 2em;
    color: var(--sc-muted);
    text-align: center;
  }
`;

export class GraphView {
  constructor({ state, actions, openDiff }) {
    this.state = state;
    this.actions = actions;
    this.openDiff = openDiff;
    this.commits = [];
    this.hasMore = false;
    this.refData = null;
    this.selected = null;
    this.details = null;
    this.host = null;
    this._onState = () => this._onStateChanged();
  }

  get isOpen() {
    return !!this.host;
  }

  open() {
    if (this.host) {
      return;
    }
    this.host = document.createElement("div");
    this.host.setAttribute("data-fontra-source-control", "graph");
    const root = this.host.attachShadow({ mode: "open" });
    isolateKeyboard(root);
    const style = document.createElement("style");
    style.textContent = styles;
    this.toolbar = el("div", { class: "toolbar" });
    this.banner = el("div", { class: "banner", hidden: true });
    this.tableArea = el("div", { class: "table-area" });
    this.detailsElement = el("div", { class: "details", hidden: true });
    root.append(
      style,
      this.toolbar,
      this.banner,
      el("div", { class: "main" }, this.tableArea, this.detailsElement)
    );
    document.body.appendChild(this.host);
    this._removeEscape = pushEscapeHandler(() => this.close());
    this.state.addListener(this._onState);
    this.state.retain();
    this._lastRevision = this.state.revision;
    this._renderToolbar();
    this.reload();
  }

  close() {
    if (!this.host) {
      return;
    }
    this._removeEscape?.();
    this.state.removeListener(this._onState);
    this.state.release();
    this.host.remove();
    this.host = null;
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  _onStateChanged() {
    if (!this.host) {
      return;
    }
    this._renderToolbar();
    const status = this.state.status;
    const headChanged = status?.branch?.oid !== this._lastHead;
    if (this.state.revision !== this._lastRevision || headChanged) {
      this._lastRevision = this.state.revision;
      this.reload();
    } else {
      // The uncommitted changes row follows the working tree
      const dirty = this.state.changeCount > 0;
      if (dirty !== this._lastDirty) {
        this._renderTable();
      }
    }
  }

  async reload() {
    const status = this.state.status;
    if (!status) {
      await this.state.refresh();
    }
    if (!this.state.status?.initialized) {
      this.tableArea.replaceChildren(
        el(
          "div",
          { class: "message" },
          this.state.connection === "unreachable"
            ? t("panel.unreachable.message", { url: this.state.client.url })
            : t("panel.notRepository")
        )
      );
      return;
    }
    this._lastHead = this.state.status.branch.oid;
    try {
      const [log, refData] = await Promise.all([
        this.state.client.call("log", {
          skip: 0,
          maxCount: Math.max(PAGE_SIZE, this.commits.length),
        }),
        this.state.client.call("refs"),
      ]);
      this.commits = log.commits;
      this.hasMore = log.hasMore;
      this.refData = refData;
      this._renderTable();
      if (this.selected) {
        if (
          this.selected === UNCOMMITTED ||
          this.commits.some((c) => c.hash === this.selected)
        ) {
          this._showDetails(this.selected);
        } else {
          this._closeDetails();
        }
      }
    } catch (error) {
      this.tableArea.replaceChildren(
        el("div", { class: "message" }, t("diff.error", { message: error.message }))
      );
    }
  }

  async _loadMore() {
    try {
      const log = await this.state.client.call("log", {
        skip: this.commits.length,
        maxCount: PAGE_SIZE,
      });
      this.commits.push(...log.commits);
      this.hasMore = log.hasMore;
      this._renderTable();
    } catch (error) {
      this.tableArea.append(el("div", { class: "message" }, error.message));
    }
  }

  _renderToolbar() {
    const status = this.state.status;
    const busy = !!this.state.busy;
    const repo = !!status?.initialized;
    const branch = status?.branch;
    const branchLabel = branch?.head ?? (branch?.oid ? branch.oid.slice(0, 8) : "");
    this.searchInput ??= el("input", {
      type: "text",
      placeholder: t("graph.search"),
      oninput: () => this._applySearch(),
    });
    const toolbarItems = [
      el("span", { class: "title" }, icon("graph"), t("graph.title")),
      branchLabel
        ? el(
            "span",
            { class: "branch" },
            icon("branch"),
            branchLabel,
            branch?.upstream ? ` ↑${branch.ahead} ↓${branch.behind}` : ""
          )
        : null,
      busy ? el("span", { class: "muted" }, `${this.state.busy}…`) : null,
      el("span", { class: "spacer" }),
      this.searchInput,
      el(
        "button",
        {
          class: "button",
          type: "button",
          disabled: !repo || busy,
          onclick: () => this.actions.fetch(),
        },
        t("action.fetch")
      ),
      el(
        "button",
        {
          class: "button",
          type: "button",
          disabled: !repo || busy,
          onclick: () => this.actions.pull(),
        },
        icon("pull"),
        t("action.pull")
      ),
      el(
        "button",
        {
          class: "button",
          type: "button",
          disabled: !repo || busy,
          onclick: () => this.actions.push(),
        },
        icon("push"),
        t("action.push")
      ),
      iconButton("more", t("action.more"), (event) =>
        this._showToolbarMenu(event.currentTarget)
      ),
      iconButton("refresh", t("action.refresh"), () => {
        this.state.refresh();
        this.reload();
      }),
      iconButton("close", t("action.close"), () => this.close()),
    ];
    this.toolbar.replaceChildren(...toolbarItems.filter(Boolean));
    if (status?.operation) {
      this.banner.hidden = false;
      this.banner.replaceChildren(
        el(
          "span",
          {},
          t("panel.operationInProgress", {
            operation: operationLabel(status.operation),
          })
        ),
        el(
          "button",
          {
            class: "button",
            type: "button",
            disabled: status.conflicts.length > 0,
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
      );
    } else {
      this.banner.hidden = true;
    }
  }

  _showToolbarMenu(anchor) {
    showMenu(
      [
        {
          label: t("action.createBranch"),
          onSelect: () => this.actions.createBranch(),
        },
        {
          label: t("action.switchBranch"),
          onSelect: () => this.actions.switchBranch(),
        },
        { label: t("action.merge"), onSelect: () => this.actions.mergeBranch() },
        "-",
        { label: t("action.stash"), onSelect: () => this.actions.stash() },
        {
          label: t("action.forcePush"),
          onSelect: () => this.actions.push({ force: true }),
        },
        "-",
        { label: t("action.addRemote"), onSelect: () => this.actions.addRemote() },
      ],
      anchor
    );
  }

  _refsByCommit() {
    const map = new Map();
    for (const ref of this.refData?.refs ?? []) {
      if (!map.has(ref.hash)) {
        map.set(ref.hash, []);
      }
      map.get(ref.hash).push(ref);
    }
    return map;
  }

  _renderTable() {
    const head = this.refData?.head ?? null;
    const dirty = this.state.changeCount > 0;
    this._lastDirty = dirty;
    const commits = [...this.commits];
    if (dirty) {
      commits.unshift({
        hash: UNCOMMITTED,
        parents: head ? [head] : [],
        subject: t("graph.uncommitted", { count: this.state.changeCount }),
        authorName: "",
        authorTime: Date.now() / 1000,
      });
    }
    if (!commits.length) {
      this.tableArea.replaceChildren(
        el("div", { class: "message" }, t("graph.noCommits"))
      );
      return;
    }
    const { rows, laneCount } = layoutGraph(commits);
    const graphWidth = Math.max(laneCount, 1) * LANE_WIDTH + 8;
    const refsByCommit = this._refsByCommit();
    const currentBranch = this.refData?.currentBranch ?? null;

    const tbody = el("tbody");
    commits.forEach((commit, index) => {
      const row = rows[index];
      const refs = refsByCommit.get(commit.hash) ?? [];
      const color = LANE_COLORS[row.color % LANE_COLORS.length];
      const isUncommitted = commit.hash === UNCOMMITTED;
      const labels = [];
      if (commit.hash === head && !currentBranch) {
        labels.push(el("span", { class: "ref detached" }, "HEAD"));
      }
      for (const ref of sortRefs(refs, currentBranch)) {
        labels.push(this._refLabel(ref, color, currentBranch));
      }
      const tr = el(
        "tr",
        {
          "class": `commit${isUncommitted ? " uncommitted" : ""}${commit.hash === head ? " head" : ""}${commit.hash === this.selected ? " selected" : ""}`,
          "data-hash": commit.hash,
          "onclick": () => this._select(commit.hash),
          "oncontextmenu": (event) => {
            event.preventDefault();
            if (!isUncommitted) {
              this._showCommitMenu(commit, event);
            }
          },
        },
        el("td", { class: "graph" }, graphCell(row, graphWidth, isUncommitted)),
        el(
          "td",
          { class: "description" },
          ...labels,
          el("span", { class: "subject" }, commit.subject)
        ),
        el(
          "td",
          {
            class: "date",
            title: isUncommitted ? "" : formatDateTime(commit.authorTime),
          },
          isUncommitted ? "" : formatRelativeTime(commit.authorTime)
        ),
        el(
          "td",
          { class: "author", title: commit.authorEmail ?? "" },
          commit.authorName
        ),
        el("td", { class: "hash" }, isUncommitted ? "" : commit.hash.slice(0, 8))
      );
      tr._commit = commit;
      tbody.append(tr);
    });

    const table = el(
      "table",
      {},
      el(
        "colgroup",
        {},
        el("col", { style: { width: `${graphWidth + 8}px` } }),
        el("col", {}),
        el("col", { style: { width: "9em" } }),
        el("col", { style: { width: "11em" } }),
        el("col", { style: { width: "6.5em" } })
      ),
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", {}, t("graph.column.graph")),
          el("th", {}, t("graph.column.description")),
          el("th", {}, t("graph.column.date")),
          el("th", {}, t("graph.column.author")),
          el("th", {}, t("graph.column.commit"))
        )
      ),
      tbody
    );
    const scrollTop = this.tableArea.scrollTop;
    const children = [table];
    if (this.hasMore) {
      children.push(
        el(
          "div",
          { class: "more" },
          el(
            "button",
            { class: "button", type: "button", onclick: () => this._loadMore() },
            t("graph.loadMore")
          )
        )
      );
    }
    this.tableArea.replaceChildren(...children);
    this.tableArea.scrollTop = scrollTop;
    this._applySearch();
  }

  _refLabel(ref, color, currentBranch) {
    const isCurrent = ref.type === "head" && ref.name === currentBranch;
    const label = el(
      "span",
      {
        class: `ref ${ref.type}${isCurrent ? " current" : ""}`,
        style: isCurrent ? { background: color } : ref.type === "tag" ? {} : { color },
        title:
          ref.type === "head"
            ? `${ref.name}${ref.upstream ? ` → ${ref.upstream}` : ""}`
            : ref.name,
        oncontextmenu: (event) => {
          event.preventDefault();
          event.stopPropagation();
          this._showRefMenu(ref, event);
        },
        ondblclick: (event) => {
          event.stopPropagation();
          if (ref.type === "head" && !isCurrent) {
            this.actions.checkout(ref.name, "branch");
          } else if (ref.type === "remote") {
            this.actions.checkout(ref.name, "remote");
          }
        },
      },
      ref.type === "tag" ? icon("tag") : icon("branch"),
      ref.name
    );
    return label;
  }

  _applySearch() {
    const query = this.searchInput?.value.trim().toLowerCase() ?? "";
    for (const row of this.tableArea.querySelectorAll("tr.commit")) {
      const commit = row._commit;
      const match =
        !query ||
        commit.hash.startsWith(query) ||
        commit.subject.toLowerCase().includes(query) ||
        (commit.authorName ?? "").toLowerCase().includes(query);
      row.classList.toggle("dimmed", !match);
    }
  }

  _select(hash) {
    if (this.selected === hash) {
      this._closeDetails();
      return;
    }
    this.selected = hash;
    for (const row of this.tableArea.querySelectorAll("tr.commit")) {
      row.classList.toggle("selected", row.dataset.hash === hash);
    }
    this._showDetails(hash);
  }

  _closeDetails() {
    this.selected = null;
    for (const row of this.tableArea.querySelectorAll("tr.selected")) {
      row.classList.remove("selected");
    }
    this.detailsElement.hidden = true;
  }

  async _showDetails(hash) {
    this.detailsElement.hidden = false;
    const token = (this._detailsToken = {});
    if (hash === UNCOMMITTED) {
      this._renderUncommittedDetails();
      return;
    }
    this.detailsElement.replaceChildren(
      el("div", { class: "message" }, t("diff.loading"))
    );
    let details;
    try {
      details = await this.state.client.call("commitDetails", { hash });
    } catch (error) {
      this.detailsElement.replaceChildren(
        el("div", { class: "message" }, error.message)
      );
      return;
    }
    if (token !== this._detailsToken) {
      return;
    }
    const [subject, ...bodyLines] = details.message.split("\n");
    const body = bodyLines.join("\n").trim();
    const meta = el(
      "div",
      { class: "meta" },
      el("span", { class: "key" }, t("graph.detail.commit")),
      el(
        "span",
        {
          class: "mono link",
          title: t("action.copyHash"),
          onclick: () => copyText(details.hash),
        },
        details.hash
      ),
      el("span", { class: "key" }, t("graph.detail.parents")),
      el(
        "span",
        { class: "mono" },
        details.parents.length
          ? details.parents.flatMap((parent, i) => [
              i ? ", " : "",
              el(
                "span",
                {
                  class: "link",
                  onclick: () => {
                    const row = this.tableArea.querySelector(
                      `tr[data-hash="${parent}"]`
                    );
                    row?.scrollIntoView({ block: "center" });
                    this._select(parent);
                  },
                },
                parent.slice(0, 8)
              ),
            ])
          : "—"
      ),
      el("span", { class: "key" }, t("graph.detail.author")),
      el(
        "span",
        {},
        `${details.authorName} <${details.authorEmail}> · ${formatDateTime(details.authorTime)}`
      ),
      details.committerName !== details.authorName ||
        details.committerEmail !== details.authorEmail
        ? [
            el("span", { class: "key" }, t("graph.detail.committer")),
            el(
              "span",
              {},
              `${details.committerName} <${details.committerEmail}> · ${formatDateTime(details.committerTime)}`
            ),
          ]
        : null
    );
    const info = el(
      "div",
      { class: "info" },
      el("h3", {}, subject),
      meta,
      body ? el("div", { class: "body" }, body) : null
    );
    const fromLabel = details.parents[0] ? details.parents[0].slice(0, 8) : "";
    const files = el(
      "div",
      { class: "files" },
      el(
        "h4",
        {},
        t("graph.detail.files", { count: details.files.length }) +
          (details.parents.length > 1 ? ` · ${t("graph.detail.vsFirstParent")}` : "")
      ),
      details.files.map((file) =>
        this._fileRow(file, () =>
          this.openDiff({
            path: file.path,
            oldPath: file.origPath ?? null,
            from: file.status === "A" ? "EMPTY" : file.from,
            to: file.status === "D" ? "EMPTY" : file.to,
            fromLabel,
            toLabel: details.hash.slice(0, 8),
            status: file.status,
          })
        )
      )
    );
    this.detailsElement.replaceChildren(
      info,
      files,
      iconButton("close", t("action.close"), () => this._closeDetails())
    );
  }

  _renderUncommittedDetails() {
    const status = this.state.status;
    if (!status?.initialized) {
      return;
    }
    const changes = [
      ...status.conflicts.map((c) => ({ ...c, kind: "conflict" })),
      ...status.staged.map((c) => ({ ...c, kind: "staged" })),
      ...status.unstaged.map((c) => ({ ...c, kind: "unstaged" })),
      ...status.untracked.map((c) => ({ ...c, kind: "untracked" })),
    ];
    const files = el(
      "div",
      { class: "files" },
      el("h4", {}, t("graph.detail.files", { count: changes.length })),
      changes.map((change) =>
        this._fileRow(
          {
            path: change.path,
            status: change.kind === "conflict" ? "U" : change.status,
          },
          () => this.openDiff(diffRequestForChange(change)),
          change.kind === "staged" ? t("label.index") : ""
        )
      )
    );
    this.detailsElement.replaceChildren(
      el(
        "div",
        { class: "info" },
        el("h3", {}, t("graph.uncommitted", { count: changes.length })),
        el("div", { class: "body muted" }, t("graph.uncommittedHint"))
      ),
      files,
      iconButton("close", t("action.close"), () => this._closeDetails())
    );
  }

  _fileRow(file, onOpen, note = "") {
    const { dir, name } = splitPath(file.path);
    const letter = file.status === "?" ? "U" : file.status;
    return el(
      "div",
      {
        class: "file-row",
        title: file.origPath ? `${file.origPath} → ${file.path}` : file.path,
        onclick: onOpen,
      },
      el("span", { class: `status-letter status-${file.status}` }, letter),
      el("span", {}, name),
      el("span", { class: "dir" }, dir),
      note ? el("span", { class: "muted" }, `· ${note}`) : null
    );
  }

  _showCommitMenu(commit, event) {
    const status = this.state.status;
    const isHead = commit.hash === this.refData?.head;
    const busy = !!this.state.busy;
    const branch = status?.branch?.head;
    showMenu(
      [
        { heading: `${commit.hash.slice(0, 8)} ${commit.subject}`.slice(0, 60) },
        {
          label: t("action.checkoutCommit"),
          disabled: busy || isHead,
          onSelect: () => this.actions.checkoutCommit(commit.hash),
        },
        {
          label: t("action.createBranchHere"),
          disabled: busy,
          onSelect: () => this.actions.createBranch(commit.hash),
        },
        {
          label: t("action.createTagHere"),
          disabled: busy,
          onSelect: () => this.actions.createTag(commit.hash),
        },
        "-",
        {
          label: t("action.mergeIntoCurrent", { branch: branch ?? "HEAD" }),
          disabled: busy || isHead,
          onSelect: () => this.actions.mergeBranch(commit.hash),
        },
        {
          label: t("action.rebaseOnto", { branch: branch ?? "HEAD" }),
          disabled: busy || isHead || !branch,
          onSelect: () => this.actions.rebaseOnto(commit.hash),
        },
        {
          label: t("action.cherryPick"),
          disabled: busy || isHead,
          onSelect: () => this.actions.cherryPick(commit.hash),
        },
        {
          label: t("action.revert"),
          disabled: busy,
          onSelect: () => this.actions.revert(commit.hash),
        },
        {
          label: t("action.resetHere", { branch: branch ?? "HEAD" }),
          disabled: busy || isHead,
          danger: true,
          onSelect: () => this.actions.reset(commit.hash),
        },
        "-",
        { label: t("action.copyHash"), onSelect: () => copyText(commit.hash) },
        { label: t("action.copySubject"), onSelect: () => copyText(commit.subject) },
      ],
      event
    );
  }

  _showRefMenu(ref, event) {
    const busy = !!this.state.busy;
    const currentBranch = this.refData?.currentBranch;
    const branch = currentBranch ?? "HEAD";
    let items;
    if (ref.type === "head") {
      const isCurrent = ref.name === currentBranch;
      items = [
        { heading: ref.name },
        {
          label: t("action.checkoutBranch"),
          disabled: busy || isCurrent,
          onSelect: () => this.actions.checkout(ref.name, "branch"),
        },
        {
          label: t("action.mergeIntoCurrent", { branch }),
          disabled: busy || isCurrent,
          onSelect: () => this.actions.mergeBranch(ref.name),
        },
        {
          label: t("action.rebaseOnto", { branch }),
          disabled: busy || isCurrent || !currentBranch,
          onSelect: () => this.actions.rebaseOnto(ref.name),
        },
        "-",
        {
          label: t("action.createBranchHere"),
          disabled: busy,
          onSelect: () => this.actions.createBranch(ref.name),
        },
        {
          label: t("action.renameBranch"),
          disabled: busy,
          onSelect: () => this.actions.renameBranch(ref.name),
        },
        {
          label: t("action.deleteBranch"),
          disabled: busy || isCurrent,
          danger: true,
          onSelect: () => this.actions.deleteBranch(ref.name),
        },
        "-",
        { label: t("action.copyName"), onSelect: () => copyText(ref.name) },
      ];
    } else if (ref.type === "remote") {
      items = [
        { heading: ref.name },
        {
          label: t("action.checkoutRemote"),
          disabled: busy,
          onSelect: () => this.actions.checkout(ref.name, "remote"),
        },
        {
          label: t("action.mergeIntoCurrent", { branch }),
          disabled: busy,
          onSelect: () => this.actions.mergeBranch(ref.name),
        },
        {
          label: t("action.rebaseOnto", { branch }),
          disabled: busy || !currentBranch,
          onSelect: () => this.actions.rebaseOnto(ref.name),
        },
        "-",
        {
          label: t("action.deleteRemoteBranch"),
          disabled: busy,
          danger: true,
          onSelect: () => this.actions.deleteRemoteBranch(ref.name),
        },
        { label: t("action.copyName"), onSelect: () => copyText(ref.name) },
      ];
    } else {
      items = [
        { heading: ref.name },
        {
          label: t("action.checkoutCommit"),
          disabled: busy,
          onSelect: () => this.actions.checkout(ref.name, "tag"),
        },
        {
          label: t("action.mergeIntoCurrent", { branch }),
          disabled: busy,
          onSelect: () => this.actions.mergeBranch(ref.name),
        },
        {
          label: t("action.pushTag"),
          disabled: busy,
          onSelect: () => this.actions.pushTag(ref.name),
        },
        {
          label: t("action.deleteTag"),
          disabled: busy,
          danger: true,
          onSelect: () => this.actions.deleteTag(ref.name),
        },
        { label: t("action.copyName"), onSelect: () => copyText(ref.name) },
      ];
    }
    showMenu(items, event);
  }
}

function sortRefs(refs, currentBranch) {
  const order = { head: 0, remote: 1, tag: 2 };
  return [...refs].sort((a, b) => {
    if (a.name === currentBranch && a.type === "head") {
      return -1;
    }
    if (b.name === currentBranch && b.type === "head") {
      return 1;
    }
    return order[a.type] - order[b.type] || a.name.localeCompare(b.name);
  });
}

function laneX(lane) {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function edgePath(from, to, y1, y2) {
  const x1 = laneX(from);
  const x2 = laneX(to);
  if (from === to) {
    return `M${x1} ${y1}L${x2} ${y2}`;
  }
  const middle = (y1 + y2) / 2;
  return `M${x1} ${y1}C${x1} ${middle} ${x2} ${middle} ${x2} ${y2}`;
}

function graphCell(row, width, isUncommitted) {
  const middle = ROW_HEIGHT / 2;
  const element = svg("svg", {
    width,
    height: ROW_HEIGHT,
    viewBox: `0 0 ${width} ${ROW_HEIGHT}`,
  });
  for (const edge of row.top) {
    element.append(
      svg("path", {
        "d": edgePath(edge.from, edge.to, 0, middle),
        "fill": "none",
        "stroke": LANE_COLORS[edge.color % LANE_COLORS.length],
        "stroke-width": 2,
      })
    );
  }
  for (const edge of row.bottom) {
    element.append(
      svg("path", {
        "d": edgePath(edge.from, edge.to, middle, ROW_HEIGHT),
        "fill": "none",
        "stroke": LANE_COLORS[edge.color % LANE_COLORS.length],
        "stroke-width": 2,
        "stroke-dasharray": isUncommitted && edge.from === row.lane ? "3 2" : null,
      })
    );
  }
  const color = LANE_COLORS[row.color % LANE_COLORS.length];
  element.append(
    svg("circle", {
      "cx": laneX(row.lane),
      "cy": middle,
      "r": DOT_RADIUS,
      "fill": isUncommitted ? "var(--sc-background)" : color,
      "stroke": color,
      "stroke-width": isUncommitted ? 2 : 1,
    })
  );
  return element;
}
