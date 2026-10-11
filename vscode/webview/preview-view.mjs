// Preview of a glyph or kerning file as it is edited: the glyph drawn with its
// nodes, components and anchors, or the font's kerning pairs drawn at their
// spacing. Reads the same formats as the diff view, through FontFiles.

import { FontFiles } from "../../src/formats/font-files.js";
import { glyphFileKind } from "../../src/formats/glyph-model.js";
import {
  groupMembers,
  kerningFileKind,
  pairKey,
  representativeGlyph,
} from "../../src/formats/kerning.js";
import { t } from "../../src/strings.js";
import {
  diffViewCSS,
  formatValue,
  pairContours,
  pairLayout,
  pairPlacement,
} from "../../src/ui/diff-view.js";
import { el, splitPath, svg } from "../../src/ui/dom.js";
import {
  GlyphCanvas,
  drawAnchors,
  drawLabel,
  drawMetrics,
  drawOutline,
  drawPoints,
  layerPairBounds,
} from "../../src/ui/glyph-canvas.js";

// The previewed file and the rest of the font are read as they are on disk,
// with unsaved edits of open editors
const REV = "WORKTREE";
const GLYPH_LIST_LIMIT = 2000;
const KERNING_ROW_LIMIT = 400;

const previewCSS = `
  :host {
    z-index: auto;
    background: none;
  }
  .window {
    margin: 0;
    border-radius: 0;
    box-shadow: none;
  }
  .banner {
    padding: 0.4em 1em;
    color: var(--vscode-errorForeground, var(--sc-removed));
    border-bottom: 1px solid var(--sc-border);
    font-size: 0.92em;
  }
  .unicodes {
    color: var(--sc-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9em;
  }
  .kerning-preview .caption {
    position: absolute;
    top: 0.5em;
    left: 0.8em;
    color: var(--sc-muted);
    font-size: 0.85em;
    pointer-events: none;
  }
`;

export class PreviewView {
  // path: the previewed file's absolute path with "/" separators
  // displayPath: the path shown in the header (relative to the workspace)
  // text: its current text, which may not be saved yet
  constructor({ client, settings, path, displayPath = path, text, extraCSS = "" }) {
    this.client = client;
    this.settings = settings;
    this.path = path;
    this.displayPath = displayPath;
    this.text = text;
    this.extraCSS = extraCSS;
    this.tabs = [];
    if (glyphFileKind(path)) {
      this.tabs.push({ id: "glyphs", label: t("diff.tab.glyphs") });
    }
    if (kerningFileKind(path)) {
      this.tabs.push({ id: "kerning", label: t("diff.tab.kerning") });
    }
    this.activeTab = this.tabs[0]?.id ?? null;
    this.state = {
      glyph: null,
      layer: null,
      sourceId: null,
      pair: null,
      pairLimit: KERNING_ROW_LIMIT,
    };
    this.files = this._makeFiles();
    this.lastGlyphs = null;
    this.lastKerning = null;
  }

  // Each update reads the font again; files of one update are cached
  _makeFiles() {
    const text = this.text;
    const readText = (rev, path) =>
      path === this.path ? Promise.resolve(text) : this.client.readText(rev, path);
    return new FontFiles(readText, this.path);
  }

  show() {
    this.host = document.createElement("div");
    const root = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = diffViewCSS + previewCSS + this.extraCSS;
    const { dir, name } = splitPath(this.displayPath);
    this.tabBar = el("div", { class: "tabs", role: "tablist" });
    this.banner = el("div", { class: "banner", hidden: true });
    this.content = el("div", { class: "content" });
    root.append(
      style,
      el(
        "div",
        { class: "window" },
        el(
          "div",
          { class: "header" },
          el(
            "div",
            { class: "heading" },
            el(
              "div",
              { class: "path" },
              el("span", { class: "name" }, name),
              el("span", { class: "dir" }, dir)
            )
          ),
          this.tabBar
        ),
        this.banner,
        this.content
      )
    );
    document.body.appendChild(this.host);
    this._renderTabs();
    this._render();
  }

  update(text) {
    this.text = text;
    this.refresh();
  }

  refresh() {
    this.files = this._makeFiles();
    this._render();
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
            onclick: () => {
              this.activeTab = tab.id;
              this._renderTabs();
              this._render();
            },
          },
          tab.label
        )
      )
    );
    this.tabBar.hidden = this.tabs.length < 2;
  }

  async _render() {
    const token = (this._token = {});
    try {
      if (this.activeTab === "glyphs") {
        await this._renderGlyphs(token);
      } else if (this.activeTab === "kerning") {
        await this._renderKerning(token);
      }
    } catch (error) {
      console.error("[fontra-glyph-diff]", error);
      if (token === this._token) {
        this._showMessage(t("preview.cannotRead", { message: error.message }));
      }
    }
  }

  _showMessage(text) {
    this.content.replaceChildren(el("div", { class: "message" }, text));
  }

  _setError(message) {
    this.banner.hidden = !message;
    this.banner.textContent = message ?? "";
  }

  // --- glyphs -------------------------------------------------------------------

  async _renderGlyphs(token) {
    let glyphs;
    let error = null;
    try {
      glyphs = await this.files.glyphsInFile(REV);
    } catch (e) {
      error = e;
    }
    if (token !== this._token) {
      return;
    }
    // While the text cannot be read (in the middle of an edit), the last
    // glyphs that could be read stay on screen
    this._setError(
      error && this.lastGlyphs ? t("preview.stale", { message: error.message }) : null
    );
    if (error) {
      if (!this.lastGlyphs) {
        this._showMessage(t("preview.cannotRead", { message: error.message }));
        return;
      }
      glyphs = this.lastGlyphs;
    } else {
      this.lastGlyphs = glyphs;
    }
    const names = [...glyphs.keys()];
    if (!names.length) {
      this._showMessage(t("preview.noGlyphs"));
      return;
    }
    if (!names.includes(this.state.glyph)) {
      this.state.glyph = names[0];
      this.state.layer = null;
    }
    const ui = (this.glyphUI ??= this._buildGlyphUI());
    ui.names = names;
    ui.list.hidden = names.length < 2;
    ui.renderItems();
    await this._renderGlyph(ui, glyphs.get(this.state.glyph), token);
    if (token === this._token && this.content.firstChild !== ui.wrapper) {
      this.content.replaceChildren(ui.wrapper);
    }
  }

  _buildGlyphUI() {
    const ui = {
      names: [],
      items: el("div", { class: "items" }),
      toolbar: el("div", { class: "glyph-toolbar" }),
      canvasArea: el("div", { class: "canvas-area" }),
      info: el("div", { class: "changes" }),
      canvas: new GlyphCanvas(),
      canvasKey: null,
    };
    ui.cell = el("div", { class: "canvas-cell" }, ui.canvas.element);
    ui.filter = el("input", {
      type: "text",
      oninput: () => ui.renderItems(),
    });
    ui.list = el("div", { class: "glyph-list" }, ui.filter, ui.items);
    ui.main = el("div", { class: "glyph-main" }, ui.toolbar, ui.canvasArea, ui.info);
    ui.wrapper = el(
      "div",
      { style: { display: "flex", flex: "1", minWidth: "0" } },
      ui.list,
      ui.main
    );
    ui.renderItems = () => {
      ui.filter.placeholder = t("diff.filterGlyphs", { count: ui.names.length });
      const query = ui.filter.value.trim().toLowerCase();
      ui.items.replaceChildren(
        ...ui.names
          .filter((name) => !query || name.toLowerCase().includes(query))
          .slice(0, GLYPH_LIST_LIMIT)
          .map((name) =>
            el(
              "button",
              {
                class: `glyph-item${name === this.state.glyph ? " selected" : ""}`,
                type: "button",
                onclick: () => {
                  this.state.glyph = name;
                  this.state.layer = null;
                  this._render();
                },
              },
              name
            )
          )
      );
    };
    return ui;
  }

  async _renderGlyph(ui, glyph, token) {
    const layers = glyph.layers;
    if (!layers.some((layer) => layer.id === this.state.layer)) {
      this.state.layer = layers[0]?.id ?? null;
    }
    const layer = layers.find((candidate) => candidate.id === this.state.layer);
    let componentContours = [];
    let missing = [];
    if (layer?.components.length) {
      ({ contours: componentContours, missing } = await this.files.componentContours(
        REV,
        glyph,
        layer
      ));
    }
    if (token !== this._token) {
      return;
    }
    const showPoints = this.settings.get("showPoints");
    ui.toolbar.replaceChildren(
      ...[
        el("span", { class: "glyph-title" }, glyph.name),
        glyph.unicodes.length
          ? el("span", { class: "unicodes" }, formatUnicodes(glyph.unicodes))
          : null,
        layers.length > 1
          ? el(
              "div",
              { class: "chips" },
              layers.map((candidate) =>
                el(
                  "button",
                  {
                    class: `chip${candidate.id === this.state.layer ? " selected" : ""}`,
                    type: "button",
                    onclick: () => {
                      this.state.layer = candidate.id;
                      this._render();
                    },
                  },
                  candidate.name
                )
              )
            )
          : null,
        el("span", { class: "spacer" }),
        el(
          "label",
          { class: "check" },
          el("input", {
            type: "checkbox",
            checked: showPoints,
            onchange: (event) => {
              this.settings.set("showPoints", event.target.checked);
              this._render();
            },
          }),
          t("diff.showPoints")
        ),
      ].filter(Boolean)
    );
    if (!layer) {
      ui.canvasArea.replaceChildren(
        el("div", { class: "message" }, t("diff.noLayers"))
      );
      ui.info.replaceChildren();
      ui.canvasKey = null;
      return;
    }
    if (ui.canvasArea.firstChild !== ui.cell) {
      ui.canvasArea.replaceChildren(ui.cell);
    }
    const drawing = { layer, contours: layer.contours, componentContours, missing };
    // The view stays where it was while the same layer is edited
    const key = `${glyph.name}\u0000${layer.id}`;
    ui.canvas.setContent(
      layerPairBounds(null, drawing),
      (group, { px }) => drawGlyph(group, drawing, { px, showPoints }),
      { keepView: key === ui.canvasKey }
    );
    ui.canvasKey = key;
    ui.info.replaceChildren(
      ...describeLayer(layer, missing).map((line) => el("div", {}, line))
    );
  }

  // --- kerning ------------------------------------------------------------------

  async _renderKerning(token) {
    let kerning = await this.files.kerning(REV);
    if (token !== this._token) {
      return;
    }
    // FontFiles reads a kerning file that cannot be parsed as no kerning; keep
    // the last pairs while the file is being edited
    const unreadable = !kerning && this.lastKerning && this.text;
    this._setError(unreadable ? t("preview.kerningStale") : null);
    if (unreadable) {
      kerning = this.lastKerning;
    } else {
      this.lastKerning = kerning;
    }
    if (!kerning || (!kerning.pairs.size && !hasGroups(kerning))) {
      this._showMessage(t("preview.noKerning"));
      return;
    }
    this.kerning = kerning;
    const sources = kerning.sources;
    if (!sources.some((source) => source.id === this.state.sourceId)) {
      this.state.sourceId = sources[0]?.id ?? null;
    }
    const ui = (this.kerningUI ??= this._buildKerningUI());
    ui.sourceSelect.replaceChildren(
      ...sources.map((source) =>
        el(
          "option",
          { value: source.id, selected: source.id === this.state.sourceId },
          source.name
        )
      )
    );
    ui.sourceSelect.hidden = sources.length < 2;
    ui.render();
    if (this.content.firstChild !== ui.container) {
      this.content.replaceChildren(ui.container);
    }
  }

  _buildKerningUI() {
    const ui = {
      title: el("span", { class: "glyph-title" }),
      preview: el("div", { class: "kerning-preview" }),
      tableArea: el("div", { class: "kerning-table" }),
      canvas: new GlyphCanvas(),
      canvasKey: null,
    };
    ui.sourceSelect = el("select", {
      onchange: () => {
        this.state.sourceId = ui.sourceSelect.value;
        ui.render();
      },
    });
    ui.filter = el("input", {
      type: "text",
      placeholder: t("diff.filterPairs"),
      oninput: () => ui.render(),
    });
    ui.caption = el("span", { class: "caption" });
    ui.preview.append(ui.canvas.element, ui.caption);
    ui.container = el(
      "div",
      { class: "kerning" },
      el(
        "div",
        { class: "glyph-toolbar" },
        ui.title,
        el("span", { class: "spacer" }),
        ui.sourceSelect,
        ui.filter
      ),
      ui.preview,
      ui.tableArea
    );
    ui.render = () => this._renderKerningTable(ui);
    return ui;
  }

  _renderKerningTable(ui) {
    const kerning = this.kerning;
    const sourceId = this.state.sourceId;
    const query = ui.filter.value.trim().toLowerCase();
    const allPairs = [...kerning.pairs.values()].filter(
      (pair) => pair.values[sourceId] !== undefined && pair.values[sourceId] !== null
    );
    ui.title.textContent = t("preview.kerningSummary", { count: allPairs.length });
    const pairs = allPairs.filter(
      (pair) =>
        !query ||
        pair.left.toLowerCase().includes(query) ||
        pair.right.toLowerCase().includes(query)
    );
    ui.observer?.disconnect();
    ui.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            ui.observer.unobserve(entry.target);
            entry.target._draw?.();
          }
        }
      },
      { root: ui.tableArea, rootMargin: "200px" }
    );
    if (!pairs.some((pair) => pairKey(pair.left, pair.right) === this.state.pair)) {
      this.state.pair = pairs[0] ? pairKey(pairs[0].left, pairs[0].right) : null;
    }
    const rows = pairs.slice(0, this.state.pairLimit).map((pair) => {
      const key = pairKey(pair.left, pair.right);
      const previewCell = el("td", { class: "preview" });
      const row = el(
        "tr",
        {
          class: `pair${key === this.state.pair ? " selected" : ""}`,
          onclick: () => {
            this.state.pair = key;
            for (const other of ui.tableArea.querySelectorAll("tr.selected")) {
              other.classList.remove("selected");
            }
            row.classList.add("selected");
            this._renderPairPreview(ui, pair);
          },
        },
        previewCell,
        el("td", { class: "side" }, this._sideLabel(pair.left, 1)),
        el("td", { class: "side" }, this._sideLabel(pair.right, 2)),
        el("td", { class: "number" }, formatValue(pair.values[sourceId]))
      );
      previewCell._draw = () => this._drawPairThumbnail(previewCell, pair);
      ui.observer.observe(previewCell);
      return row;
    });
    const head = el(
      "tr",
      {},
      el("th", { class: "preview" }, t("diff.kerning.preview")),
      el("th", {}, t("diff.kerning.left")),
      el("th", {}, t("diff.kerning.right")),
      el("th", { class: "number", style: { textAlign: "right" } }, t("preview.value"))
    );
    const children = [el("table", {}, el("thead", {}, head), el("tbody", {}, rows))];
    if (pairs.length > this.state.pairLimit) {
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
                this.state.pairLimit += KERNING_ROW_LIMIT;
                ui.render();
              },
            },
            t("diff.showMorePairs", { count: pairs.length - this.state.pairLimit })
          )
        )
      );
    }
    if (hasGroups(kerning)) {
      children.push(renderGroups(kerning));
    }
    ui.tableArea.replaceChildren(...children);
    ui.preview.hidden = !pairs.length;
    const selected = pairs.find(
      (pair) => pairKey(pair.left, pair.right) === this.state.pair
    );
    if (selected) {
      this._renderPairPreview(ui, selected);
    }
  }

  _sideLabel(side, which) {
    const members = groupMembers(this.kerning, side, which);
    return el(
      "span",
      { title: members?.length ? members.join(" ") : "" },
      side,
      members?.length ? el("span", { class: "members" }, members.join(" ")) : null
    );
  }

  // { left, right, leftName, rightName, value }, as the diff view's pair
  // drawing functions take it
  async _pairDrawing(pair) {
    const sourceId = this.state.sourceId;
    const leftName = representativeGlyph(this.kerning, pair.left, 1);
    const rightName = representativeGlyph(this.kerning, pair.right, 2);
    const [left, right] = await Promise.all([
      this._kerningGlyph(leftName, sourceId),
      this._kerningGlyph(rightName, sourceId),
    ]);
    return { left, right, leftName, rightName, value: pair.values[sourceId] };
  }

  async _kerningGlyph(name, sourceId) {
    const glyph = name ? await this.files.glyph(REV, name) : null;
    if (!glyph) {
      return null;
    }
    const layer = await this.files.kerningGlyphLayer(REV, name, sourceId);
    if (!layer) {
      return null;
    }
    let contours = layer.contours;
    if (layer.components.length) {
      const resolved = await this.files.componentContours(REV, glyph, layer);
      contours = [...contours, ...resolved.contours];
    }
    return { advance: layer.advance || 0, contours };
  }

  async _drawPairThumbnail(cell, pair) {
    const side = await this._pairDrawing(pair);
    const layout = pairLayout({ old: null, new: side });
    const element = svg("svg", {
      viewBox: layout.viewBox,
      preserveAspectRatio: "xMidYMid meet",
    });
    const group = svg("g", { transform: "scale(1,-1)" });
    drawPair(group, side, { px: layout.px * 2.5, thumbnail: true });
    element.append(group);
    cell.replaceChildren(element);
  }

  async _renderPairPreview(ui, pair) {
    const token = (this._pairToken = {});
    const side = await this._pairDrawing(pair);
    if (token !== this._pairToken) {
      return;
    }
    const key = `${this.state.sourceId}\u0000${pairKey(pair.left, pair.right)}`;
    const source = this.kerning.sources.find((s) => s.id === this.state.sourceId);
    ui.caption.textContent =
      `${pair.left} ${pair.right} · ${formatValue(side.value)}` +
      (this.kerning.sources.length > 1 && source ? ` · ${source.name}` : "");
    ui.canvas.setContent(
      pairLayout({ old: null, new: side }).bounds,
      (group, { px }) => drawPair(group, side, { px }),
      { keepView: key === ui.canvasKey }
    );
    ui.canvasKey = key;
  }
}

// --- drawing -----------------------------------------------------------------------

function drawGlyph(group, drawing, { px, showPoints }) {
  drawMetrics(group, drawing, { px });
  drawOutline(group, drawing.componentContours, {
    fill: "var(--sc-component-fill)",
    stroke: "var(--sc-muted)",
    px,
    width: 0.6,
  });
  drawOutline(group, drawing.contours, {
    fill: "var(--sc-preview-fill)",
    stroke: "var(--sc-new-outline)",
    px,
    width: 0.8,
  });
  if (showPoints) {
    drawPoints(group, drawing.contours, { px, color: "var(--sc-new-outline)" });
  }
  const anchors = drawing.layer.anchors;
  drawAnchors(group, anchors, { px, color: "var(--sc-moved)" });
  for (const anchor of anchors) {
    drawLabel(group, anchor.name, anchor.x + 6 * px, anchor.y + 6 * px, {
      px,
      color: "var(--sc-moved)",
      size: 10,
    });
  }
}

// A pair at its spacing: the left glyph at 0 and the right glyph after the
// left glyph's advance plus the kerning value. The dashed lines mark where the
// right glyph would start without kerning (gray) and where it starts (blue).
function drawPair(group, side, { px, thumbnail = false }) {
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
  drawOutline(group, pairContours(side), {
    fill: "var(--sc-preview-fill)",
    stroke: thumbnail ? "none" : "var(--sc-new-outline)",
    px,
    width: 0.8,
  });
  if (thumbnail) {
    return;
  }
  const placement = pairPlacement(side);
  if (!side.left) {
    drawLabel(group, `${side.leftName ?? "?"}?`, 0, 20, {
      px,
      color: "var(--sc-muted)",
    });
  }
  if (!side.right) {
    drawLabel(group, `${side.rightName ?? "?"}?`, placement.rightOffset, 20, {
      px,
      color: "var(--sc-muted)",
    });
  }
  for (const mark of [
    { x: placement.leftAdvance, color: "var(--sc-muted)" },
    { x: placement.rightOffset, color: "var(--sc-moved)" },
  ]) {
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

// --- text --------------------------------------------------------------------------

function describeLayer(layer, missing) {
  const nodes = layer.contours.reduce((sum, contour) => sum + contour.points.length, 0);
  const lines = [t("preview.advance", { value: round(layer.advance || 0) })];
  // A glyph made only of components has no contours of its own to count
  if (layer.contours.length || !layer.components.length) {
    lines.push(t("preview.outline", { contours: layer.contours.length, nodes }));
  }
  if (layer.components.length) {
    lines.push(
      t("preview.components", {
        names: layer.components.map((component) => component.name).join(", "),
      })
    );
  }
  if (layer.anchors.length) {
    lines.push(
      t("preview.anchors", {
        names: layer.anchors.map((anchor) => anchor.name).join(", "),
      })
    );
  }
  if (missing.length) {
    lines.push(t("diff.missingComponents", { names: missing.join(", ") }));
  }
  return lines;
}

function hasGroups(kerning) {
  return Object.keys(kerning.groups1).length + Object.keys(kerning.groups2).length > 0;
}

function renderGroups(kerning) {
  const list = el(
    "div",
    { class: "group-changes" },
    el("h3", {}, t("diff.groupChanges"))
  );
  for (const [groups, which] of [
    [kerning.groups1, 1],
    [kerning.groups2, 2],
  ]) {
    const side =
      which === 1 ? t("diff.kerning.leftGroup") : t("diff.kerning.rightGroup");
    for (const [name, members] of Object.entries(groups)) {
      list.append(
        el(
          "div",
          {},
          el("strong", {}, `@${name}`),
          el("span", { class: "muted" }, ` (${side}) `),
          members.join(" ")
        )
      );
    }
  }
  return list;
}

function formatUnicodes(values) {
  return values
    .map((v) => `U+${v.toString(16).toUpperCase().padStart(4, "0")}`)
    .join(" ");
}

function round(value) {
  return Math.round(value * 100) / 100;
}
