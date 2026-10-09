// Full-window view comparing two versions of a file. Glyph files get a drawing
// of both outlines (overlaid or side by side), kerning files a table of
// changed pairs drawn at their old and new spacing, and every text file a
// line diff.

import { FontFiles } from "../formats/font-files.js";
import { changedGlyphNames, diffGlyph } from "../formats/glyph-diff.js";
import { glyphFileKind } from "../formats/glyph-model.js";
import {
  diffKerning,
  groupMembers,
  kerningFileKind,
  representativeGlyph,
} from "../formats/kerning.js";
import { contoursBounds, unionBounds } from "../formats/outline.js";
import { t } from "../strings.js";
import { countChanges, parseUnifiedDiff } from "../unified-diff.js";
import {
  baseCSS,
  el,
  iconButton,
  isolateKeyboard,
  overlayZIndex,
  pushEscapeHandler,
  showToast,
  splitPath,
  svg,
} from "./dom.js";
import {
  GlyphCanvas,
  drawAnchors,
  drawFillDiff,
  drawLabel,
  drawLoosePoints,
  drawMetrics,
  drawMoves,
  drawOutline,
  drawPoints,
  layerPairBounds,
} from "./glyph-canvas.js";

const TEXT_LINE_LIMIT = 4000;
const KERNING_ROW_LIMIT = 400;

const styles = `
  ${baseCSS}
  :host {
    position: fixed;
    inset: 0;
    z-index: ${overlayZIndex() + 5};
    display: flex;
    align-items: stretch;
    justify-content: stretch;
    background: #8888;
  }
  .window {
    flex: 1;
    margin: 2.5vh 2.5vw;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--sc-background);
    border-radius: 0.5em;
    box-shadow: 1px 3px 8px #0006;
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 0.8em;
    padding: 0.7em 0.8em 0.7em 1.1em;
    border-bottom: 1px solid var(--sc-border);
  }
  .heading {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15em;
  }
  .heading .path {
    display: flex;
    align-items: baseline;
    gap: 0.5em;
    min-width: 0;
  }
  .heading .name {
    font-weight: bold;
    font-size: 1.1em;
    white-space: nowrap;
  }
  .heading .dir, .heading .revs {
    color: var(--sc-muted);
    font-size: 0.88em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tabs {
    display: flex;
    gap: 0.2em;
    padding: 0.2em;
    background: var(--sc-button);
    border-radius: 1em;
  }
  .tab {
    padding: 0.25em 0.9em;
    border: none;
    border-radius: 1em;
    background: none;
    cursor: pointer;
    white-space: nowrap;
  }
  .tab.active {
    background: var(--sc-accent);
    color: var(--sc-accent-foreground);
  }
  .content {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }
  .message {
    margin: auto;
    padding: 2em;
    color: var(--sc-muted);
    text-align: center;
    line-height: 1.5;
  }

  /* glyphs */
  .glyph-list {
    width: 14em;
    flex: none;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--sc-border);
    min-height: 0;
  }
  .glyph-list input {
    margin: 0.6em;
  }
  .glyph-list .items {
    flex: 1;
    overflow: auto;
    padding: 0 0.4em 0.6em;
  }
  .glyph-item {
    display: flex;
    align-items: center;
    gap: 0.4em;
    width: 100%;
    padding: 0.25em 0.5em;
    border: none;
    border-radius: 0.35em;
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .glyph-item:hover {
    background: var(--sc-hover);
  }
  .glyph-item.selected {
    background: var(--sc-selected);
  }
  .glyph-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .glyph-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5em 0.8em;
    padding: 0.6em 0.9em;
    border-bottom: 1px solid var(--sc-border);
  }
  .glyph-title {
    font-weight: bold;
    font-size: 1.05em;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3em;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    padding: 0.2em 0.65em;
    border-radius: 1em;
    border: 1px solid transparent;
    background: var(--sc-button);
    cursor: pointer;
    font-size: 0.92em;
  }
  .chip.selected {
    border-color: var(--sc-foreground);
    background: var(--sc-selected);
  }
  .chip.unchanged {
    opacity: 0.6;
  }
  .dot {
    width: 0.55em;
    height: 0.55em;
    border-radius: 50%;
    background: var(--sc-muted);
  }
  .dot.modified { background: var(--sc-modified); }
  .dot.added { background: var(--sc-added); }
  .dot.removed { background: var(--sc-removed); }
  .spacer {
    flex: 1;
  }
  .segmented {
    display: inline-flex;
    border-radius: 1em;
    overflow: hidden;
    background: var(--sc-button);
  }
  .segmented button {
    padding: 0.25em 0.9em;
    border: none;
    background: none;
    cursor: pointer;
  }
  .segmented button.active {
    background: var(--sc-accent);
    color: var(--sc-accent-foreground);
  }
  label.check {
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    cursor: pointer;
  }
  .canvas-area {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 1px;
    background: var(--sc-border);
  }
  .canvas-cell {
    flex: 1;
    min-width: 0;
    position: relative;
    background: var(--sc-surface);
  }
  .canvas-cell .caption {
    position: absolute;
    top: 0.5em;
    left: 0.7em;
    font-size: 0.85em;
    color: var(--sc-muted);
    pointer-events: none;
  }
  svg.glyph-canvas {
    width: 100%;
    height: 100%;
    display: block;
    cursor: grab;
    touch-action: none;
  }
  .legend {
    position: absolute;
    right: 0.7em;
    bottom: 0.5em;
    display: flex;
    gap: 0.9em;
    font-size: 0.82em;
    color: var(--sc-muted);
    pointer-events: none;
  }
  .legend span::before {
    content: "";
    display: inline-block;
    width: 1.4em;
    height: 0;
    margin-right: 0.35em;
    vertical-align: middle;
    border-top: 2px solid currentColor;
  }
  .legend .old { color: var(--sc-old-outline); }
  .legend [class^="dot-"]::before {
    width: 0.6em;
    height: 0.6em;
    border: none;
    border-radius: 50%;
    background: currentColor;
  }
  .legend [class^="area-"]::before {
    width: 0.9em;
    height: 0.9em;
    border: none;
    border-radius: 0.15em;
  }
  .legend .area-removed::before { background: var(--sc-removed-fill); }
  .legend .area-added::before { background: var(--sc-added-fill); }
  .legend .dot-moved { color: var(--sc-moved); }
  .legend .dot-added { color: var(--sc-added); }
  .legend .dot-removed { color: var(--sc-removed); }
  .legend .old::before { border-top-style: dashed; }
  .legend .new { color: var(--sc-foreground); }
  .changes {
    max-height: 9em;
    overflow: auto;
    padding: 0.6em 1em;
    border-top: 1px solid var(--sc-border);
    display: flex;
    flex-direction: column;
    gap: 0.25em;
    line-height: 1.4;
  }

  /* kerning */
  .kerning {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .kerning-preview {
    height: 38%;
    min-height: 10em;
    position: relative;
    border-bottom: 1px solid var(--sc-border);
    background: var(--sc-surface);
  }
  .kerning-table {
    flex: 1;
    overflow: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    position: sticky;
    top: 0;
    background: var(--sc-background);
    text-align: left;
    font-weight: bold;
    font-size: 0.88em;
    padding: 0.45em 0.7em;
    border-bottom: 1px solid var(--sc-border);
    z-index: 1;
  }
  td {
    padding: 0.2em 0.7em;
    border-bottom: 1px solid var(--sc-border);
    vertical-align: middle;
  }
  tr.pair {
    cursor: pointer;
  }
  tr.pair:hover td {
    background: var(--sc-hover);
  }
  tr.pair.selected td {
    background: var(--sc-selected);
  }
  td.number, th.number {
    width: 7em;
  }
  td.number {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  th.preview, td.preview {
    width: 190px;
    padding: 0.15em 0.4em;
  }
  td.preview svg {
    width: 180px;
    height: 54px;
    display: block;
  }
  .side .members {
    display: block;
    font-size: 0.82em;
    color: var(--sc-muted);
    max-width: 18em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .delta-changed { color: var(--sc-moved); }
  .delta-added { color: var(--sc-added); }
  .delta-removed { color: var(--sc-removed); }
  .none {
    color: var(--sc-muted);
  }
  .group-changes {
    padding: 0.6em 1em 1em;
    display: flex;
    flex-direction: column;
    gap: 0.35em;
  }
  .group-changes h3 {
    margin: 0.4em 0 0.2em;
    font-size: 0.95em;
  }
  .more-row {
    padding: 0.8em;
    text-align: center;
  }

  /* text */
  .text-diff {
    flex: 1;
    overflow: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 1.5;
    background: var(--sc-surface);
  }
  .text-diff table {
    width: auto;
    min-width: 100%;
  }
  .text-diff td {
    border: none;
    padding: 0 0.6em;
    white-space: pre;
  }
  .text-diff td.ln {
    width: 1%;
    text-align: right;
    color: var(--sc-muted);
    user-select: none;
  }
  .text-diff tr.add td { background: var(--sc-added-background); }
  .text-diff tr.remove td { background: var(--sc-removed-background); }
  .text-diff tr.hunk td {
    color: var(--sc-muted);
    background: var(--sc-surface-alt);
    padding-top: 0.2em;
    padding-bottom: 0.2em;
  }
  .text-diff td.marker {
    width: 1%;
    user-select: none;
  }
  .text-summary {
    padding: 0.5em 1em;
    color: var(--sc-muted);
    border-bottom: 1px solid var(--sc-border);
    font-size: 0.9em;
  }
`;

export class DiffView {
  static open(options) {
    const view = new DiffView(options);
    view.show();
    return view;
  }

  // request: { path, oldPath, from, to, fromLabel, toLabel, status }
  constructor({ client, settings, request }) {
    this.client = client;
    this.settings = settings;
    this.request = request;
    const readText = (rev, path) =>
      rev === "EMPTY" ? Promise.resolve(null) : client.readText(rev, path);
    this.files = new FontFiles(readText, request.path);
    this.glyphKind = glyphFileKind(request.path);
    this.kerningKind = kerningFileKind(request.path);
    this.tabs = [];
    if (this.glyphKind) {
      this.tabs.push({ id: "glyphs", label: t("diff.tab.glyphs") });
    }
    if (this.kerningKind) {
      this.tabs.push({ id: "kerning", label: t("diff.tab.kerning") });
    }
    this.tabs.push({ id: "text", label: t("diff.tab.text") });
    this.activeTab = this.tabs[0].id;
    this.glyphState = {
      mode: settings.get("glyphDiffMode"),
      selectedGlyph: null,
      selectedLayer: null,
    };
  }

  show() {
    this.host = document.createElement("div");
    this.host.setAttribute("data-fontra-source-control", "diff");
    const root = this.host.attachShadow({ mode: "open" });
    isolateKeyboard(root);
    const style = document.createElement("style");
    style.textContent = styles;
    const { dir, name } = splitPath(this.request.path);
    this.tabBar = el("div", { class: "tabs", role: "tablist" });
    this.content = el("div", { class: "content" });
    const revs = [this.request.fromLabel, this.request.toLabel]
      .filter(Boolean)
      .join(" → ");
    this.window = el(
      "div",
      { "class": "window", "role": "dialog", "aria-modal": "true" },
      el(
        "div",
        { class: "header" },
        el(
          "div",
          { class: "heading" },
          el(
            "div",
            { class: "path" },
            el(
              "span",
              { class: `status-letter status-${this.request.status ?? "M"}` },
              this.request.status === "?" ? "U" : (this.request.status ?? "")
            ),
            el("span", { class: "name" }, name),
            el("span", { class: "dir" }, dir)
          ),
          el(
            "div",
            { class: "revs" },
            this.request.oldPath
              ? `${this.request.oldPath} → ${this.request.path} · `
              : "",
            revs
          )
        ),
        this.tabBar,
        iconButton("close", t("action.close"), () => this.close())
      ),
      this.content
    );
    root.append(style, this.window);
    // A click on the dimmed area around the window closes the view
    this.host.addEventListener("pointerdown", (event) => {
      if (event.composedPath()[0] === this.host) {
        this.close();
      }
    });
    this._removeEscape = pushEscapeHandler(() => this.close());
    document.body.appendChild(this.host);
    this._renderTabs();
    this._showTab(this.activeTab);
  }

  close() {
    this._removeEscape?.();
    this.host?.remove();
    this.host = null;
  }

  _renderTabs() {
    this.tabBar.replaceChildren(
      ...this.tabs.map((tab) =>
        el(
          "button",
          {
            class: `tab${tab.id === this.activeTab ? " active" : ""}`,
            type: "button",
            role: "tab",
            onclick: () => this._showTab(tab.id),
          },
          tab.label
        )
      )
    );
    this.tabBar.hidden = this.tabs.length < 2;
  }

  async _showTab(id) {
    this.activeTab = id;
    this._renderTabs();
    this.content.replaceChildren(el("div", { class: "message" }, t("diff.loading")));
    const token = (this._token = {});
    try {
      let element;
      if (id === "glyphs") {
        element = await this._renderGlyphsTab();
      } else if (id === "kerning") {
        element = await this._renderKerningTab();
      } else {
        element = await this._renderTextTab();
      }
      if (token === this._token && this.host) {
        this.content.replaceChildren(element);
      }
    } catch (error) {
      console.error("[source-control]", error);
      if (token === this._token && this.host) {
        this.content.replaceChildren(
          el("div", { class: "message" }, t("diff.error", { message: error.message }))
        );
      }
    }
  }

  // --- text ---------------------------------------------------------------------

  async _renderTextTab() {
    if (!this._patch) {
      const { path, oldPath, from, to } = this.request;
      this._patch = await this.client.call("diff", { path, oldPath, from, to });
    }
    const result = this._patch;
    if (result.old.binary || result.new.binary) {
      return el("div", { class: "message" }, t("diff.binary"));
    }
    const parsed = parseUnifiedDiff(result.patch);
    if (!parsed.hunks.length) {
      return el("div", { class: "message" }, t("diff.noTextChanges"));
    }
    const { added, removed } = countChanges(parsed);
    const container = el("div", { class: "text-diff" });
    const summary = el(
      "div",
      { class: "text-summary" },
      t("diff.lineSummary", { added, removed })
    );
    const table = el("table");
    let rendered = 0;
    const renderRows = (limit) => {
      const rows = [];
      outer: for (const hunk of parsed.hunks) {
        rows.push(el("tr", { class: "hunk" }, el("td", { colspan: 4 }, hunk.header)));
        for (const line of hunk.lines) {
          if (rows.length >= limit) {
            break outer;
          }
          const marker = line.type === "add" ? "+" : line.type === "remove" ? "−" : " ";
          rows.push(
            el(
              "tr",
              { class: line.type },
              el("td", { class: "ln" }, line.oldLine ?? ""),
              el("td", { class: "ln" }, line.newLine ?? ""),
              el("td", { class: "marker" }, marker),
              el("td", {}, line.text)
            )
          );
        }
      }
      rendered = rows.length;
      table.replaceChildren(...rows);
    };
    renderRows(TEXT_LINE_LIMIT);
    container.append(summary, table);
    const total = parsed.hunks.reduce((sum, hunk) => sum + hunk.lines.length + 1, 0);
    if (total > rendered) {
      const more = el(
        "div",
        { class: "more-row" },
        el(
          "button",
          {
            class: "button",
            type: "button",
            onclick: () => {
              renderRows(Infinity);
              more.remove();
            },
          },
          t("diff.showAllLines", { count: total })
        )
      );
      container.append(more);
    }
    return el(
      "div",
      { style: { display: "flex", flex: "1", minWidth: "0" } },
      container
    );
  }

  // --- glyphs -------------------------------------------------------------------

  async _renderGlyphsTab() {
    const { from, to, path, oldPath } = this.request;
    if (!this._glyphs) {
      const [oldGlyphs, newGlyphs] = await Promise.all([
        this.files.glyphsInFile(from, oldPath ?? path),
        this.files.glyphsInFile(to, path),
      ]);
      const names =
        this.glyphKind === "glyphs"
          ? changedGlyphNames(oldGlyphs, newGlyphs)
          : [...new Set([...newGlyphs.keys(), ...oldGlyphs.keys()])];
      this._glyphs = { oldGlyphs, newGlyphs, names };
    }
    const { names } = this._glyphs;
    if (!names.length) {
      return el("div", { class: "message" }, t("diff.noGlyphChanges"));
    }
    if (!names.includes(this.glyphState.selectedGlyph)) {
      this.glyphState.selectedGlyph = names[0];
    }
    const main = el("div", { class: "glyph-main" });
    const wrapper = el("div", { style: { display: "flex", flex: "1", minWidth: "0" } });
    if (names.length > 1) {
      wrapper.append(this._renderGlyphList(names, main));
    }
    wrapper.append(main);
    this._renderGlyph(main);
    return wrapper;
  }

  _renderGlyphList(names, main) {
    const { oldGlyphs, newGlyphs } = this._glyphs;
    const items = el("div", { class: "items" });
    const filter = el("input", {
      type: "text",
      placeholder: t("diff.filterGlyphs", { count: names.length }),
      oninput: () => renderItems(),
    });
    const renderItems = () => {
      const query = filter.value.trim().toLowerCase();
      items.replaceChildren(
        ...names
          .filter((name) => !query || name.toLowerCase().includes(query))
          .slice(0, 2000)
          .map((name) => {
            const status = !oldGlyphs.has(name)
              ? "added"
              : !newGlyphs.has(name)
                ? "removed"
                : "modified";
            return el(
              "button",
              {
                class: `glyph-item${name === this.glyphState.selectedGlyph ? " selected" : ""}`,
                type: "button",
                onclick: () => {
                  this.glyphState.selectedGlyph = name;
                  this.glyphState.selectedLayer = null;
                  renderItems();
                  this._renderGlyph(main);
                },
              },
              el("span", { class: `dot ${status}` }),
              name
            );
          })
      );
    };
    renderItems();
    return el("div", { class: "glyph-list" }, filter, items);
  }

  async _renderGlyph(main) {
    const { oldGlyphs, newGlyphs } = this._glyphs;
    const name = this.glyphState.selectedGlyph;
    const oldGlyph = oldGlyphs.get(name) ?? null;
    const newGlyph = newGlyphs.get(name) ?? null;
    // A renamed .glif has different glyph names on each side
    const single = this._glyphs.names.length === 2 && this.glyphKind !== "glyphs";
    const diff = single
      ? diffGlyph(
          [...oldGlyphs.values()][0] ?? null,
          [...newGlyphs.values()][0] ?? null
        )
      : diffGlyph(oldGlyph, newGlyph);
    const layers = diff.layers;
    if (!layers.some((layer) => layer.id === this.glyphState.selectedLayer)) {
      this.glyphState.selectedLayer = (
        layers.find((layer) => layer.status !== "unchanged") ?? layers[0]
      )?.id;
    }
    const layerDiff = layers.find(
      (layer) => layer.id === this.glyphState.selectedLayer
    );

    const chips = el(
      "div",
      { class: "chips" },
      layers.map((layer) =>
        el(
          "button",
          {
            class: `chip ${layer.status}${layer.id === this.glyphState.selectedLayer ? " selected" : ""}`,
            type: "button",
            title: t(`layerStatus.${layer.status}`),
            onclick: () => {
              this.glyphState.selectedLayer = layer.id;
              this._renderGlyph(main);
            },
          },
          el("span", { class: `dot ${layer.status}` }),
          layer.name
        )
      )
    );
    const mode = this.glyphState.mode;
    const setMode = (value) => {
      this.glyphState.mode = value;
      this.settings.set("glyphDiffMode", value);
      this._renderGlyph(main);
    };
    const pointsCheckbox = el("input", {
      type: "checkbox",
      checked: this.settings.get("showPoints"),
      onchange: (event) => {
        this.settings.set("showPoints", event.target.checked);
        this._renderGlyph(main);
      },
    });
    const toolbar = el(
      "div",
      { class: "glyph-toolbar" },
      el("span", { class: "glyph-title" }, diff.name || name),
      chips,
      el("span", { class: "spacer" }),
      el(
        "div",
        { class: "segmented" },
        el(
          "button",
          {
            type: "button",
            class: mode === "overlay" ? "active" : "",
            onclick: () => setMode("overlay"),
          },
          t("diff.mode.overlay")
        ),
        el(
          "button",
          {
            type: "button",
            class: mode === "sideBySide" ? "active" : "",
            onclick: () => setMode("sideBySide"),
          },
          t("diff.mode.sideBySide")
        )
      ),
      el("label", { class: "check" }, pointsCheckbox, t("diff.showPoints"))
    );
    const canvasArea = el("div", { class: "canvas-area" });
    const changes = el(
      "div",
      { class: "changes" },
      ...describeGlyphChanges(diff, layerDiff)
    );
    main.replaceChildren(toolbar, canvasArea, changes);

    if (!layerDiff) {
      canvasArea.append(el("div", { class: "message" }, t("diff.noLayers")));
      return;
    }
    const token = (this._glyphToken = {});
    const [oldDrawing, newDrawing] = await Promise.all([
      this._layerDrawing(
        this.request.from,
        single ? [...oldGlyphs.values()][0] : oldGlyph,
        layerDiff.old
      ),
      this._layerDrawing(
        this.request.to,
        single ? [...newGlyphs.values()][0] : newGlyph,
        layerDiff.new
      ),
    ]);
    if (token !== this._glyphToken) {
      return;
    }
    const bounds = layerPairBounds(oldDrawing, newDrawing);
    const showPoints = this.settings.get("showPoints");
    const missing = [
      ...new Set([...(oldDrawing?.missing ?? []), ...(newDrawing?.missing ?? [])]),
    ];
    if (missing.length) {
      changes.append(
        el(
          "div",
          { class: "muted" },
          t("diff.missingComponents", { names: missing.join(", ") })
        )
      );
    }

    if (mode === "overlay") {
      const canvas = new GlyphCanvas();
      canvasArea.append(
        el(
          "div",
          { class: "canvas-cell" },
          canvas.element,
          el(
            "div",
            { class: "legend" },
            oldDrawing
              ? el(
                  "span",
                  { class: "old" },
                  this.request.fromLabel || t("label.before")
                )
              : null,
            newDrawing
              ? el("span", { class: "new" }, this.request.toLabel || t("label.after"))
              : null,
            ...nodeLegend(layerDiff)
          )
        )
      );
      canvas.setContent(bounds, (group, { px }) =>
        drawOverlay(group, oldDrawing, newDrawing, layerDiff, { px, showPoints })
      );
    } else {
      const oldCanvas = new GlyphCanvas();
      const newCanvas = new GlyphCanvas();
      oldCanvas.link(newCanvas);
      canvasArea.append(
        el(
          "div",
          { class: "canvas-cell" },
          oldCanvas.element,
          el("span", { class: "caption" }, this.request.fromLabel || t("label.before"))
        ),
        el(
          "div",
          { class: "canvas-cell" },
          newCanvas.element,
          el("span", { class: "caption" }, this.request.toLabel || t("label.after")),
          el("div", { class: "legend" }, ...nodeLegend(layerDiff))
        )
      );
      oldCanvas.setContent(bounds, (group, { px }) =>
        drawSide(group, oldDrawing, newDrawing, layerDiff, "old", { px, showPoints })
      );
      newCanvas.setContent(bounds, (group, { px }) =>
        drawSide(group, oldDrawing, newDrawing, layerDiff, "new", { px, showPoints })
      );
    }
  }

  async _layerDrawing(rev, glyph, layer) {
    if (!glyph || !layer) {
      return null;
    }
    let componentContours = [];
    let missing = [];
    if (layer.components.length) {
      ({ contours: componentContours, missing } = await this.files.componentContours(
        rev,
        glyph,
        layer
      ));
    }
    return { layer, contours: layer.contours, componentContours, missing };
  }

  // --- kerning ------------------------------------------------------------------

  async _renderKerningTab() {
    const { from, to } = this.request;
    if (!this._kerning) {
      const [oldKerning, newKerning] = await Promise.all([
        this.files.kerning(from),
        this.files.kerning(to),
      ]);
      this._kerning = {
        oldKerning,
        newKerning,
        diff: diffKerning(oldKerning, newKerning),
      };
    }
    const { diff } = this._kerning;
    if (!diff.pairs.length && !diff.groups.length) {
      return el("div", { class: "message" }, t("diff.noKerningChanges"));
    }
    const container = el("div", { class: "kerning" });
    const preview = el("div", { class: "kerning-preview" });
    const tableArea = el("div", { class: "kerning-table" });
    const sourceSelect = el(
      "select",
      { onchange: () => renderTable() },
      el("option", { value: "" }, t("diff.allSources")),
      diff.sources
        .map((source) => ({
          source,
          count: diff.pairs.filter((pair) => pair.sourceId === source.id).length,
        }))
        .filter(({ count }) => count > 0)
        .map(({ source, count }) =>
          el("option", { value: source.id }, `${source.name} (${count})`)
        )
    );
    const filter = el("input", {
      type: "text",
      placeholder: t("diff.filterPairs"),
      oninput: () => renderTable(),
    });
    const toolbar = el(
      "div",
      { class: "glyph-toolbar" },
      el(
        "span",
        { class: "glyph-title" },
        t("diff.kerningSummary", { count: diff.pairs.length })
      ),
      el("span", { class: "spacer" }),
      diff.sources.length > 1 ? sourceSelect : null,
      filter
    );
    const sourceNames = Object.fromEntries(diff.sources.map((s) => [s.id, s.name]));
    let selected = null;
    let limit = KERNING_ROW_LIMIT;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            observer.unobserve(entry.target);
            entry.target._draw?.();
          }
        }
      },
      { root: tableArea, rootMargin: "200px" }
    );

    const selectPair = (pair, row) => {
      selected = pair;
      for (const other of tableArea.querySelectorAll("tr.selected")) {
        other.classList.remove("selected");
      }
      row?.classList.add("selected");
      this._renderPairPreview(preview, pair, sourceNames);
    };

    const renderTable = () => {
      const sourceId = sourceSelect.value;
      const query = filter.value.trim().toLowerCase();
      const pairs = diff.pairs.filter(
        (pair) =>
          (!sourceId || pair.sourceId === sourceId) &&
          (!query ||
            pair.left.toLowerCase().includes(query) ||
            pair.right.toLowerCase().includes(query))
      );
      const rows = pairs.slice(0, limit).map((pair) => {
        const previewCell = el("td", { class: "preview" });
        const row = el(
          "tr",
          {
            class: `pair${pair === selected ? " selected" : ""}`,
            onclick: () => selectPair(pair, row),
          },
          previewCell,
          el("td", { class: "side" }, this._sideLabel(pair.left, 1)),
          el("td", { class: "side" }, this._sideLabel(pair.right, 2)),
          diff.sources.length > 1
            ? el("td", {}, sourceNames[pair.sourceId] ?? pair.sourceId)
            : null,
          el("td", { class: "number" }, formatValue(pair.old)),
          el("td", { class: "number" }, formatValue(pair.new)),
          el("td", { class: "number" }, formatDelta(pair))
        );
        previewCell._draw = () => this._drawPairThumbnail(previewCell, pair);
        observer.observe(previewCell);
        return row;
      });
      const head = el(
        "tr",
        {},
        el("th", { class: "preview" }, t("diff.kerning.preview")),
        el("th", {}, t("diff.kerning.left")),
        el("th", {}, t("diff.kerning.right")),
        diff.sources.length > 1 ? el("th", {}, t("diff.kerning.source")) : null,
        el(
          "th",
          { class: "number", style: { textAlign: "right" } },
          this.request.fromLabel || t("label.before")
        ),
        el(
          "th",
          { class: "number", style: { textAlign: "right" } },
          this.request.toLabel || t("label.after")
        ),
        el("th", { class: "number", style: { textAlign: "right" } }, "Δ")
      );
      const children = [el("table", {}, el("thead", {}, head), el("tbody", {}, rows))];
      if (pairs.length > limit) {
        children.push(
          el(
            "div",
            { class: "more-row" },
            el(
              "button",
              {
                class: "button",
                type: "button",
                onclick: () => {
                  limit += KERNING_ROW_LIMIT;
                  renderTable();
                },
              },
              t("diff.showMorePairs", { count: pairs.length - limit })
            )
          )
        );
      }
      if (diff.groups.length) {
        children.push(this._renderGroupChanges(diff.groups));
      }
      tableArea.replaceChildren(...children);
      if (!selected && pairs.length) {
        selectPair(pairs[0], tableArea.querySelector("tr.pair"));
      }
    };

    if (diff.pairs.length) {
      container.append(toolbar, preview, tableArea);
    } else {
      container.append(toolbar, tableArea);
    }
    renderTable();
    return container;
  }

  _sideLabel(side, which) {
    const members = groupMembers(
      this._kerning.newKerning ?? this._kerning.oldKerning,
      side,
      which
    );
    return el(
      "span",
      { title: members?.length ? members.join(" ") : "" },
      side,
      members?.length ? el("span", { class: "members" }, members.join(" ")) : null
    );
  }

  _renderGroupChanges(groups) {
    const list = el(
      "div",
      { class: "group-changes" },
      el("h3", {}, t("diff.groupChanges"))
    );
    for (const group of groups) {
      const side =
        group.side === 1 ? t("diff.kerning.leftGroup") : t("diff.kerning.rightGroup");
      const parts = [];
      if (group.status === "added") {
        parts.push(t("diff.group.added"));
      } else if (group.status === "removed") {
        parts.push(t("diff.group.removed"));
      }
      if (group.added.length) {
        parts.push(`+ ${group.added.join(" ")}`);
      }
      if (group.removed.length) {
        parts.push(`− ${group.removed.join(" ")}`);
      }
      list.append(
        el(
          "div",
          {},
          el("strong", {}, `@${group.name}`),
          el("span", { class: "muted" }, ` (${side}) `),
          parts.join("  ")
        )
      );
    }
    return list;
  }

  // Loads both sides of a pair: { old: PairDrawing, new: PairDrawing }
  async _pairDrawings(pair) {
    const { oldKerning, newKerning } = this._kerning;
    const load = async (rev, kerning, value) => {
      if (!kerning) {
        return null;
      }
      const leftName = representativeGlyph(kerning, pair.left, 1);
      const rightName = representativeGlyph(kerning, pair.right, 2);
      const [left, right] = await Promise.all([
        this._kerningGlyph(rev, leftName, pair.sourceId),
        this._kerningGlyph(rev, rightName, pair.sourceId),
      ]);
      return { left, right, leftName, rightName, value };
    };
    const [oldSide, newSide] = await Promise.all([
      load(this.request.from, oldKerning ?? newKerning, pair.old),
      load(this.request.to, newKerning ?? oldKerning, pair.new),
    ]);
    return { old: oldSide, new: newSide };
  }

  async _kerningGlyph(rev, name, sourceId) {
    if (!name || rev === "EMPTY") {
      return null;
    }
    const glyph = await this.files.glyph(rev, name);
    if (!glyph) {
      return null;
    }
    const layer = await this.files.kerningGlyphLayer(rev, name, sourceId);
    if (!layer) {
      return null;
    }
    let contours = layer.contours;
    if (layer.components.length) {
      const resolved = await this.files.componentContours(rev, glyph, layer);
      contours = [...contours, ...resolved.contours];
    }
    return { advance: layer.advance || 0, contours };
  }

  async _drawPairThumbnail(cell, pair) {
    const drawings = await this._pairDrawings(pair);
    const layout = pairLayout(drawings);
    const element = svg("svg", {
      viewBox: layout.viewBox,
      preserveAspectRatio: "xMidYMid meet",
    });
    const group = svg("g", { transform: "scale(1,-1)" });
    drawPair(group, drawings, { px: layout.px * 2.5, thumbnail: true });
    element.append(group);
    cell.replaceChildren(element);
  }

  async _renderPairPreview(container, pair, sourceNames) {
    const token = (this._pairToken = {});
    const drawings = await this._pairDrawings(pair);
    if (token !== this._pairToken) {
      return;
    }
    const layout = pairLayout(drawings);
    const canvas = new GlyphCanvas();
    const caption =
      `${pair.left} ${pair.right}` +
      (sourceNames[pair.sourceId] ? ` · ${sourceNames[pair.sourceId]}` : "");
    container.replaceChildren(
      canvas.element,
      el(
        "span",
        {
          class: "caption",
          style: { position: "absolute", top: "0.5em", left: "0.8em" },
        },
        caption
      ),
      el(
        "div",
        { class: "legend" },
        el(
          "span",
          { class: "area-removed" },
          `${this.request.fromLabel || t("label.before")}: ${formatValue(pair.old)}`
        ),
        el(
          "span",
          { class: "area-added" },
          `${this.request.toLabel || t("label.after")}: ${formatValue(pair.new)}`
        )
      )
    );
    canvas.setContent(layout.bounds, (group, { px }) =>
      drawPair(group, drawings, { px })
    );
  }
}

// --- glyph drawing ------------------------------------------------------------------

function allContours(drawing) {
  return drawing ? [...drawing.contours, ...drawing.componentContours] : [];
}

function drawOverlay(group, oldDrawing, newDrawing, layerDiff, { px, showPoints }) {
  if (
    oldDrawing &&
    newDrawing &&
    oldDrawing.layer.advance !== newDrawing.layer.advance
  ) {
    drawMetrics(group, oldDrawing, { px, color: "var(--sc-removed)", dashed: true });
  }
  if (newDrawing || oldDrawing) {
    drawMetrics(group, newDrawing ?? oldDrawing, { px });
  }
  // Red: only before, green: only after, gray: both
  drawFillDiff(
    group,
    oldDrawing && allContours(oldDrawing),
    newDrawing && allContours(newDrawing)
  );
  if (oldDrawing && newDrawing) {
    drawOutline(group, allContours(oldDrawing), {
      fill: "none",
      stroke: "var(--sc-removed)",
      px,
      dashed: true,
      width: 0.8,
    });
  }
  if (newDrawing) {
    drawOutline(group, allContours(newDrawing), {
      fill: "none",
      stroke: "var(--sc-new-outline)",
      px,
      width: 0.8,
    });
    if (showPoints) {
      const moved = new Set(
        layerDiff.points.moved.map((m) => `${m.contour}:${m.point}`)
      );
      drawPoints(group, newDrawing.contours, {
        px,
        color: "var(--sc-muted)",
        highlight: moved,
        highlightColor: "var(--sc-moved)",
      });
    }
    drawAnchors(group, newDrawing.layer.anchors, { px, color: "var(--sc-muted)" });
  }
  if (oldDrawing && newDrawing) {
    drawMoves(group, layerDiff.points.moved, { px, color: "var(--sc-moved)" });
    drawLoosePoints(group, layerDiff.points.removed, {
      px,
      color: "var(--sc-removed)",
    });
    drawLoosePoints(group, layerDiff.points.added, { px, color: "var(--sc-added)" });
  }
}

// Both sides use the same colors: gray for the area both versions share, red
// for the area only the before version has (left), green for the area only
// the after version has (right), blue for moved nodes.
function drawSide(group, oldDrawing, newDrawing, layerDiff, side, { px, showPoints }) {
  const drawing = side === "old" ? oldDrawing : newDrawing;
  if (!drawing) {
    return;
  }
  drawMetrics(group, drawing, { px });
  drawFillDiff(
    group,
    oldDrawing && allContours(oldDrawing),
    newDrawing && allContours(newDrawing),
    {
      which: side,
    }
  );
  drawOutline(group, allContours(drawing), {
    fill: "none",
    stroke: "var(--sc-new-outline)",
    px,
    width: 0.8,
  });
  if (showPoints) {
    const moved = new Set(layerDiff.points.moved.map((m) => `${m.contour}:${m.point}`));
    drawPoints(group, drawing.contours, {
      px,
      color: "var(--sc-muted)",
      highlight: moved,
      highlightColor: "var(--sc-moved)",
    });
  }
  if (side === "old") {
    drawLoosePoints(group, layerDiff.points.removed, {
      px,
      color: "var(--sc-removed)",
    });
  } else {
    drawLoosePoints(group, layerDiff.points.added, { px, color: "var(--sc-added)" });
  }
  drawAnchors(group, drawing.layer.anchors, { px, color: "var(--sc-muted)" });
}

function nodeLegend(layerDiff) {
  const points = layerDiff.points;
  const both = layerDiff.old && layerDiff.new;
  return [
    both ? el("span", { class: "area-removed" }, t("diff.legend.removedArea")) : null,
    both ? el("span", { class: "area-added" }, t("diff.legend.addedArea")) : null,
    points.moved.length
      ? el("span", { class: "dot-moved" }, t("diff.legend.moved"))
      : null,
    points.added.length
      ? el("span", { class: "dot-added" }, t("diff.legend.added"))
      : null,
    points.removed.length
      ? el("span", { class: "dot-removed" }, t("diff.legend.removed"))
      : null,
  ].filter(Boolean);
}

function describeGlyphChanges(diff, layerDiff) {
  const lines = [];
  if (diff.unicodes) {
    lines.push(
      t("change.unicodes", {
        old: formatUnicodes(diff.unicodes.old),
        new: formatUnicodes(diff.unicodes.new),
      })
    );
  }
  if (layerDiff) {
    if (layerDiff.status === "added") {
      lines.push(t("change.layerAdded"));
    } else if (layerDiff.status === "removed") {
      lines.push(t("change.layerRemoved"));
    } else if (layerDiff.status === "unchanged") {
      lines.push(t("change.layerUnchanged"));
    }
    for (const change of layerDiff.changes) {
      lines.push(...describeChange(change));
    }
  }
  if (diff.status === "added") {
    lines.unshift(t("change.glyphAdded"));
  } else if (diff.status === "removed") {
    lines.unshift(t("change.glyphRemoved"));
  }
  return lines.map((line) => el("div", {}, line));
}

function describeChange(change) {
  switch (change.type) {
    case "advance":
      return [t("change.advance", { old: round(change.old), new: round(change.new) })];
    case "contours":
      return [t("change.contours", { old: change.old, new: change.new })];
    case "points":
      return [t("change.points", { old: change.old, new: change.new })];
    case "pointsMoved":
      return [t("change.pointsMoved", { count: change.count })];
    case "pointTypes":
      return [t("change.pointTypes")];
    case "components":
    case "anchors": {
      const lines = [];
      const prefix =
        change.type === "components" ? "change.component" : "change.anchor";
      if (change.added.length) {
        lines.push(t(`${prefix}Added`, { names: change.added.join(", ") }));
      }
      if (change.removed.length) {
        lines.push(t(`${prefix}Removed`, { names: change.removed.join(", ") }));
      }
      if (change.changed.length) {
        lines.push(t(`${prefix}Changed`, { names: change.changed.join(", ") }));
      }
      return lines;
    }
  }
  return [];
}

function formatUnicodes(values) {
  return values.length
    ? values.map((v) => `U+${v.toString(16).toUpperCase().padStart(4, "0")}`).join(" ")
    : "—";
}

function round(value) {
  return Math.round(value * 100) / 100;
}

// --- kerning drawing ------------------------------------------------------------------

function formatValue(value) {
  return value === null || value === undefined ? "—" : String(round(value));
}

// Blue for a changed value, green for a new pair, red for a removed one
function formatDelta(pair) {
  const delta = (pair.new ?? 0) - (pair.old ?? 0);
  const kind = pair.old === null ? "added" : pair.new === null ? "removed" : "changed";
  if (!delta && kind === "changed") {
    return el("span", { class: "none" }, "0");
  }
  return el(
    "span",
    { class: `delta-${kind}` },
    `${delta > 0 ? "+" : ""}${round(delta)}`
  );
}

// Placement of the glyphs of both versions of a pair. Missing glyphs are
// drawn as empty boxes with their name.
function pairPlacement(side) {
  if (!side) {
    return null;
  }
  const leftAdvance = side.left?.advance ?? 500;
  const rightOffset = leftAdvance + (side.value ?? 0);
  return { leftAdvance, rightOffset, rightAdvance: side.right?.advance ?? 500 };
}

function pairLayout(drawings) {
  const boxes = [];
  for (const side of [drawings.old, drawings.new]) {
    const placement = pairPlacement(side);
    if (!placement) {
      continue;
    }
    boxes.push({
      xMin: 0,
      yMin: 0,
      xMax: placement.rightOffset + placement.rightAdvance,
      yMax: 0,
    });
    const leftBounds = side.left ? contoursBounds(side.left.contours) : null;
    const rightBounds = side.right ? contoursBounds(side.right.contours) : null;
    boxes.push(leftBounds);
    if (rightBounds) {
      boxes.push({
        ...rightBounds,
        xMin: rightBounds.xMin + placement.rightOffset,
        xMax: rightBounds.xMax + placement.rightOffset,
      });
    }
  }
  const bounds = unionBounds(...boxes) ?? { xMin: 0, yMin: 0, xMax: 1000, yMax: 700 };
  if (bounds.yMax - bounds.yMin < 200) {
    bounds.yMax = bounds.yMin + 700;
  }
  const width = bounds.xMax - bounds.xMin;
  const height = bounds.yMax - bounds.yMin;
  const margin = Math.max(width, height) * 0.06;
  const viewBox = `${bounds.xMin - margin} ${-bounds.yMax - margin} ${width + 2 * margin} ${height + 2 * margin}`;
  return { bounds, viewBox, px: (width + 2 * margin) / 180 };
}

function translateContours(contours, dx) {
  return contours.map((contour) => ({
    closed: contour.closed,
    points: contour.points.map((p) => ({ ...p, x: p.x + dx })),
  }));
}

// Contours of a pair as drawn: the left glyph at 0, the right glyph moved by
// the left advance plus the kerning value
function pairContours(side) {
  if (!side) {
    return null;
  }
  const placement = pairPlacement(side);
  return [
    ...(side.left?.contours ?? []),
    ...(side.right
      ? translateContours(side.right.contours, placement.rightOffset)
      : []),
  ];
}

// Same fill colors as glyph diffs: the area only the old spacing covers is
// red, the area only the new spacing covers is green, the shared area gray
function drawPair(group, drawings, { px, thumbnail = false }) {
  const oldSide = drawings.old;
  const newSide = drawings.new;
  const oldPlacement = pairPlacement(oldSide);
  const newPlacement = pairPlacement(newSide);
  group.append(
    svg("line", {
      "x1": -10000,
      "y1": 0,
      "x2": 10000,
      "y2": 0,
      "stroke": "var(--sc-metrics)",
      "stroke-width": px,
    })
  );
  const oldContours = pairContours(oldSide);
  const newContours = pairContours(newSide);
  drawFillDiff(group, oldContours, newContours);
  const main = newSide ?? oldSide;
  const placement = newPlacement ?? oldPlacement;
  drawOutline(group, newContours ?? oldContours, {
    fill: "none",
    stroke: "var(--sc-new-outline)",
    px,
    width: thumbnail ? 0.6 : 0.8,
  });
  if (thumbnail) {
    return;
  }
  if (!main.left) {
    drawLabel(group, `${main.leftName ?? "?"}?`, 0, 20, {
      px,
      color: "var(--sc-muted)",
    });
  }
  if (!main.right) {
    drawLabel(group, `${main.rightName ?? "?"}?`, placement.rightOffset, 20, {
      px,
      color: "var(--sc-muted)",
    });
  }
  // Markers at the right glyph's origin: where it would sit without kerning,
  // and where the old and new values put it
  const marks = [
    { x: placement.leftAdvance, color: "var(--sc-metrics)" },
    oldPlacement && newSide
      ? { x: oldPlacement.rightOffset, color: "var(--sc-removed)" }
      : null,
    {
      x: placement.rightOffset,
      color: newSide ? "var(--sc-added)" : "var(--sc-removed)",
    },
  ].filter(Boolean);
  for (const mark of marks) {
    group.append(
      svg("line", {
        "x1": mark.x,
        "y1": -150,
        "x2": mark.x,
        "y2": 1000,
        "stroke": mark.color,
        "stroke-width": 1.2 * px,
        "stroke-dasharray": `${4 * px} ${3 * px}`,
      })
    );
  }
}

export function openDiff(client, settings, request) {
  try {
    return DiffView.open({ client, settings, request });
  } catch (error) {
    showToast(error.message, "error");
    return null;
  }
}
