// Small DOM helpers shared by the panel, the diff view and the graph view:
// element creation, theme colors, icons, popup menus, dialogs and toasts.

import { currentLanguage, t } from "../strings.js";

export function el(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value === undefined || value === null || value === false) {
      continue;
    }
    if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2), value);
    } else if (key === "class") {
      element.className = value;
    } else if (key === "style" && typeof value === "object") {
      Object.assign(element.style, value);
    } else if (key === "html") {
      element.innerHTML = value;
    } else if (key in element && typeof value !== "string") {
      element[key] = value;
    } else {
      element.setAttribute(key, value === true ? "" : value);
    }
  }
  element.append(
    ...children
      .flat()
      .filter((child) => child !== null && child !== undefined && child !== false)
  );
  return element;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function svg(tag, attributes = {}, ...children) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value === undefined || value === null) {
      continue;
    }
    if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2), value);
    } else {
      element.setAttribute(key, value);
    }
  }
  element.append(...children.flat().filter(Boolean));
  return element;
}

// Same light/dark switch as Fontra's theme-support.js: Fontra sets
// --fontra-theme-marker so that only one of the two values is valid.
export function themeColorCSS(colors, selector = ":host") {
  const lines = [];
  for (const [name, [light, dark]] of Object.entries(colors)) {
    lines.push(`--${name}-light: var(--fontra-theme-marker) ${light};`);
    lines.push(`--${name}-dark: ${dark};`);
    lines.push(`--${name}: var(--${name}-light, var(--${name}-dark));`);
  }
  return `${selector} {\n  ${lines.join("\n  ")}\n}\n`;
}

// Colors Fontra has no variable for, as [light, dark] pairs. Values follow
// Fontra's own components (ui-list.js, menu-panel.js, shared.css).
export const themeColors = {
  "sc-muted": ["#777", "#aaa"],
  "sc-hover": ["#0000000d", "#ffffff14"],
  "sc-selected": ["#ddd", "#555"], // ui-list row-selected-background-color
  "sc-button": ["#ddd", "#666"], // shared.css .fontra-button
  "sc-button-hover": ["#ccc", "#777"],
  "sc-menu-background": ["#f0f0f0", "#333"], // menu-panel.js
  // Diff colors: red = removed / before, green = added, blue = changed / moved
  "sc-moved": ["#1f6feb", "#58a6ff"],
  "sc-added": ["#1a7f37", "#3fb950"],
  "sc-modified": ["#1f6feb", "#58a6ff"],
  "sc-renamed": ["#1f6feb", "#58a6ff"],
  "sc-added-background": ["#1a8f3c1f", "#5fd17f24"],
  "sc-removed-background": ["#f117591a", "#ff336629"],
  "sc-old-fill": ["#f1175912", "#ff33661c"],
  "sc-new-fill": ["#0000001f", "#ffffff26"],
  // Fill-based glyph diff: shared area, area only before, area only after
  "sc-common-fill": ["#0000002e", "#ffffff38"],
  "sc-removed-fill": ["#f1175999", "#ff3366a6"],
  "sc-added-fill": ["#2da44ea6", "#3fb950a6"],
  "sc-metrics": ["#00000033", "#ffffff33"],
};

// Everything else comes from Fontra's own theme variables (core.css), so the
// plugin follows Fontra's light/dark setting.
const fontraAliases = `
  --sc-foreground: var(--ui-element-foreground-color, black);
  --sc-background: var(--background-color, #f6f6f6);
  --sc-surface: var(--ui-element-background-color, white);
  --sc-surface-alt: var(--text-input-background-color, #eee);
  --sc-input-background: var(--text-input-background-color, #eee);
  --sc-input-foreground: var(--text-input-foreground-color, black);
  --sc-border: var(--horizontal-rule-color, #aaa8);
  --sc-accent: var(--fontra-red-color, #f11759);
  --sc-accent-foreground: white;
  --sc-removed: var(--fontra-red-color, #f11759);
  --sc-conflict: var(--fontra-light-red-color, #ff3366);
  --sc-old-outline: var(--fontra-red-color, #f11759);
  --sc-new-outline: var(--foreground-color, black);
`;

export const baseCSS = `
  ${themeColorCSS(themeColors)}
  :host {
    ${fontraAliases}
    color: var(--sc-foreground);
    font-family: fontra-ui-regular, -apple-system, sans-serif;
    font-feature-settings: "tnum" 1;
    font-size: 13px;
  }
  * {
    box-sizing: border-box;
  }
  button {
    font: inherit;
    color: inherit;
  }
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35em;
    padding: 0.3em 1.2em;
    border-radius: 1em;
    border: none;
    background: var(--sc-button);
    color: var(--sc-foreground);
    cursor: pointer;
    white-space: nowrap;
    transition: 100ms;
  }
  .button:hover:not(:disabled) {
    background: var(--sc-button-hover);
  }
  .button.primary {
    background: var(--sc-accent);
    color: var(--sc-accent-foreground);
  }
  .button.primary:hover:not(:disabled) {
    filter: brightness(1.15);
    background: var(--sc-accent);
  }
  .button:active:not(:disabled) {
    filter: brightness(0.9);
  }
  .button.danger {
    background: var(--sc-accent);
    color: var(--sc-accent-foreground);
  }
  .button.danger:hover:not(:disabled) {
    filter: brightness(1.15);
    background: var(--sc-accent);
  }
  .button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75em;
    height: 1.75em;
    padding: 0;
    border: none;
    border-radius: 0.35em;
    background: transparent;
    cursor: pointer;
    flex: none;
  }
  .icon-button:hover:not(:disabled) {
    background: var(--sc-hover);
  }
  .icon-button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .icon {
    display: inline-flex;
    width: 1.15em;
    height: 1.15em;
    flex: none;
  }
  .icon svg {
    width: 100%;
    height: 100%;
  }
  input[type="text"], textarea, select {
    font: inherit;
    color: var(--sc-input-foreground);
    background: var(--sc-input-background);
    border: none;
    border-radius: 0.25em;
    padding: 0.35em 0.5em;
  }
  input[type="text"]:focus, textarea:focus, select:focus {
    outline: 1px solid var(--sc-muted);
    outline-offset: 0;
  }
  input[type="checkbox"] {
    accent-color: var(--sc-accent);
  }
  .status-letter {
    display: inline-block;
    min-width: 1.2em;
    text-align: center;
    font-weight: bold;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9em;
  }
  .status-A, .status-\\? { color: var(--sc-added); }
  .status-D { color: var(--sc-removed); }
  .status-M, .status-T { color: var(--sc-modified); }
  .status-R, .status-C { color: var(--sc-renamed); }
  .status-U { color: var(--sc-conflict); }
  .muted {
    color: var(--sc-muted);
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
`;

const ICON_PATHS = {
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  more: '<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  discard: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  branch:
    '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10"/><path d="M18 9c0 4-6 3.5-11 8.3"/>',
  sync: '<path d="M7 4v14"/><path d="m3 14 4 4 4-4"/><path d="M17 20V6"/><path d="m13 10 4-4 4 4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  graph:
    '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 8v8"/><path d="M8 6.5c5 0 8 1.5 9 3.8"/>',
  pull: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
  push: '<path d="M12 20V8"/><path d="m7 13 5-5 5 5"/><path d="M5 4h14"/>',
  stash:
    '<path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M3 4h18v4H3z"/><path d="M10 12h4"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
  open: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  warning: '<path d="M12 3 2 20h20z"/><path d="M12 10v4"/><path d="M12 17v.5"/>',
};

export function icon(name) {
  const span = document.createElement("span");
  span.className = "icon";
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] ?? ""}</svg>`;
  return span;
}

export function iconButton(name, title, onClick, extra = {}) {
  return el(
    "button",
    {
      "class": "icon-button",
      "type": "button",
      "title": title,
      "aria-label": title,
      "onclick": (event) => {
        event.stopPropagation();
        onClick(event);
      },
      ...extra,
    },
    icon(name)
  );
}

// --- overlay layer: menus, dialogs and toasts live in one shadow root ---------

const LAYER_Z_INDEX = 10000;

const layerCSS = `
  ${baseCSS}
  :host {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: ${LAYER_Z_INDEX + 10};
  }
  .menu {
    position: fixed;
    pointer-events: auto;
    min-width: 13em;
    max-width: 26em;
    max-height: 70vh;
    overflow-y: auto;
    padding: 0.2em 0 0.3em;
    background: var(--sc-menu-background);
    border: solid gray 0.5px;
    border-radius: 6px;
    box-shadow: 2px 3px 10px #00000020;
    font-size: 1rem;
    user-select: none;
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 0.6em;
    width: 100%;
    padding: 0.1em 0.8em 0.1em 1.5em;
    border: none;
    background: none;
    text-align: left;
    cursor: pointer;
    font-size: inherit;
  }
  .menu-item:hover:not(:disabled), .menu-item:focus-visible {
    background: var(--sc-accent);
    color: var(--sc-accent-foreground);
    outline: none;
  }
  .menu-item:hover:not(:disabled) .detail, .menu-item:focus-visible .detail {
    color: inherit;
  }
  .menu-item:disabled {
    color: #8080a0;
    cursor: default;
  }
  .menu-item.danger:not(:hover) {
    color: var(--sc-removed);
  }
  .menu-item .label {
    flex: 1;
  }
  .menu-item .detail {
    color: var(--sc-muted);
    font-size: 0.9em;
  }
  .menu-separator {
    height: 1px;
    margin: 0.3em 0 0.2em;
    background: #80808080;
  }
  .menu-heading {
    padding: 0.3em 0.7em 0.15em;
    font-size: 0.85em;
    color: var(--sc-muted);
  }
  .backdrop {
    position: fixed;
    inset: 0;
    pointer-events: auto;
    background: #8888;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dialog {
    width: min(30em, calc(100vw - 2em));
    max-height: calc(100vh - 4em);
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 0.8em;
    padding: 1em;
    background: var(--sc-surface);
    border-radius: 0.5em;
    box-shadow: 1px 3px 8px #0006;
    font-size: 1.1em;
  }
  .dialog h2 {
    margin: 0;
    font-size: 1em;
    font-weight: bold;
  }
  .dialog p {
    margin: 0;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .dialog label.field {
    display: flex;
    flex-direction: column;
    gap: 0.3em;
  }
  .dialog label.check {
    display: flex;
    align-items: center;
    gap: 0.45em;
  }
  .dialog .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 0.5em;
    margin-top: 0.3em;
  }
  .dialog .detail {
    font-size: 0.9em;
    color: var(--sc-muted);
    max-height: 12em;
    overflow: auto;
    white-space: pre-wrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background: var(--sc-input-background);
    border-radius: 0.25em;
    padding: 0.5em;
  }
  .toasts {
    position: fixed;
    right: 1em;
    bottom: 1em;
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    align-items: flex-end;
  }
  .toast {
    pointer-events: auto;
    max-width: min(32em, calc(100vw - 2em));
    padding: 0.6em 0.9em;
    border-radius: 0.5em;
    background: var(--sc-surface);
    border-left: 4px solid var(--sc-muted);
    box-shadow: 1px 3px 8px #0004;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.4;
    cursor: pointer;
  }
  .toast.error {
    border-left-color: var(--sc-accent);
  }
  .toast.success {
    border-left-color: var(--sc-added);
  }
`;

let layer = null;

function overlayLayer() {
  if (layer?.isConnected) {
    return layer.shadowRoot;
  }
  layer = document.createElement("div");
  layer.setAttribute("data-fontra-source-control", "layer");
  layer.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = layerCSS;
  layer.shadowRoot.append(style, el("div", { class: "toasts" }));
  document.body.appendChild(layer);
  return layer.shadowRoot;
}

// items: { label, detail, onSelect, disabled, danger } | "-" | { heading }
export function showMenu(items, anchor) {
  const root = overlayLayer();
  root.querySelector(".menu")?._close?.();
  const menu = el("div", { class: "menu", role: "menu" });
  const close = () => {
    menu.remove();
    window.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", close);
  };
  menu._close = close;
  for (const item of items) {
    if (!item) {
      continue;
    }
    if (item === "-") {
      menu.append(el("div", { class: "menu-separator" }));
      continue;
    }
    if (item.heading) {
      menu.append(el("div", { class: "menu-heading" }, item.heading));
      continue;
    }
    menu.append(
      el(
        "button",
        {
          class: `menu-item${item.danger ? " danger" : ""}`,
          type: "button",
          role: "menuitem",
          disabled: !!item.disabled,
          onclick: () => {
            close();
            item.onSelect?.();
          },
        },
        el("span", { class: "label" }, item.label),
        item.detail ? el("span", { class: "detail" }, item.detail) : null
      )
    );
  }
  root.append(menu);

  let x;
  let y;
  if (anchor instanceof Event) {
    x = anchor.clientX;
    y = anchor.clientY;
  } else {
    const rect = anchor.getBoundingClientRect();
    x = rect.left;
    y = rect.bottom + 2;
  }
  const rect = menu.getBoundingClientRect();
  x = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4));
  if (y + rect.height > window.innerHeight - 4) {
    y = Math.max(4, y - rect.height - (anchor instanceof Event ? 0 : 30));
  }
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const onOutside = (event) => {
    if (!event.composedPath().includes(menu)) {
      close();
    }
  };
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const buttons = [...menu.querySelectorAll(".menu-item:not(:disabled)")];
      const index = buttons.indexOf(root.activeElement);
      const next =
        event.key === "ArrowDown"
          ? buttons[(index + 1) % buttons.length]
          : buttons[(index - 1 + buttons.length) % buttons.length];
      next?.focus();
    }
  };
  setTimeout(() => {
    window.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", close);
  });
  return close;
}

// A modal dialog. fields: { key, type: "text" | "textarea" | "checkbox" |
// "select", label, value, placeholder, options: [{ value, label }] }.
// Resolves with the field values (an object), or null when cancelled.
export function showDialog({
  title,
  message = "",
  detail = "",
  fields = [],
  okLabel = t("dialog.ok"),
  cancelLabel = t("dialog.cancel"),
  danger = false,
  validate = null,
}) {
  const root = overlayLayer();
  return new Promise((resolve) => {
    const inputs = {};
    const fieldElements = fields.map((field) => {
      if (field.type === "checkbox") {
        const input = el("input", { type: "checkbox", checked: !!field.value });
        inputs[field.key] = input;
        return el("label", { class: "check" }, input, field.label);
      }
      let input;
      if (field.type === "textarea") {
        input = el("textarea", { rows: 4, placeholder: field.placeholder ?? "" });
        input.value = field.value ?? "";
      } else if (field.type === "select") {
        input = el(
          "select",
          {},
          field.options.map((option) =>
            el("option", { value: option.value }, option.label ?? option.value)
          )
        );
        input.value = field.value ?? field.options[0]?.value ?? "";
      } else {
        input = el("input", {
          type: "text",
          placeholder: field.placeholder ?? "",
          spellcheck: "false",
          autocomplete: "off",
        });
        input.value = field.value ?? "";
      }
      inputs[field.key] = input;
      return el("label", { class: "field" }, el("span", {}, field.label), input);
    });
    const errorLine = el("p", { class: "status-D", hidden: true });
    const values = () =>
      Object.fromEntries(
        fields.map((field) => [
          field.key,
          field.type === "checkbox"
            ? inputs[field.key].checked
            : inputs[field.key].value,
        ])
      );
    const finish = (result) => {
      backdrop.remove();
      resolve(result);
    };
    const submit = () => {
      const result = values();
      const problem = validate?.(result);
      if (problem) {
        errorLine.textContent = problem;
        errorLine.hidden = false;
        return;
      }
      finish(result);
    };
    const okButton = el(
      "button",
      {
        class: `button ${danger ? "danger" : "primary"}`,
        type: "button",
        onclick: submit,
      },
      okLabel
    );
    const dialog = el(
      "div",
      { "class": "dialog", "role": "dialog", "aria-modal": "true" },
      el("h2", {}, title),
      message ? el("p", {}, message) : null,
      detail ? el("div", { class: "detail" }, detail) : null,
      ...fieldElements,
      errorLine,
      el(
        "div",
        { class: "buttons" },
        cancelLabel
          ? el(
              "button",
              { class: "button", type: "button", onclick: () => finish(null) },
              cancelLabel
            )
          : null,
        okButton
      )
    );
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        finish(null);
      } else if (
        event.key === "Enter" &&
        (event.target?.tagName !== "TEXTAREA" || event.metaKey || event.ctrlKey)
      ) {
        event.stopPropagation();
        event.preventDefault();
        submit();
      } else {
        // Keep Fontra's own shortcuts from firing while typing in the dialog
        event.stopPropagation();
      }
    };
    const backdrop = el(
      "div",
      {
        class: "backdrop",
        onpointerdown: (event) => {
          if (event.target === backdrop) {
            finish(null);
          }
        },
        onkeydown: onKey,
        onkeyup: (event) => event.stopPropagation(),
      },
      dialog
    );
    root.append(backdrop);
    const firstInput = Object.values(inputs).find((input) => input.type !== "checkbox");
    (firstInput ?? okButton).focus();
    if (firstInput?.select) {
      firstInput.select();
    }
  });
}

export async function confirmDialog(options) {
  return (await showDialog(options)) !== null;
}

export function showToast(
  message,
  kind = "info",
  duration = kind === "error" ? 9000 : 3500
) {
  const root = overlayLayer();
  const container = root.querySelector(".toasts");
  const toast = el("div", { class: `toast ${kind}`, role: "status" }, message);
  const remove = () => toast.remove();
  toast.addEventListener("click", remove);
  container.append(toast);
  setTimeout(remove, duration);
}

// Full-window views close with Escape, topmost first
const escapeHandlers = [];

function handleEscape(event) {
  if (event.key !== "Escape" || !escapeHandlers.length || event.defaultPrevented) {
    return false;
  }
  event.stopPropagation();
  event.preventDefault();
  escapeHandlers.at(-1)();
  return true;
}

export function pushEscapeHandler(handler) {
  if (!escapeHandlers.length) {
    window.addEventListener("keydown", handleEscape);
  }
  escapeHandlers.push(handler);
  return () => {
    const index = escapeHandlers.lastIndexOf(handler);
    if (index >= 0) {
      escapeHandlers.splice(index, 1);
    }
    if (!escapeHandlers.length) {
      window.removeEventListener("keydown", handleEscape);
    }
  };
}

// Stops keyboard events inside a host element from reaching Fontra's global
// shortcuts (Fontra listens on window for single-key tool shortcuts).
export function isolateKeyboard(element) {
  element.addEventListener("keydown", (event) => {
    handleEscape(event);
    event.stopPropagation();
  });
  for (const type of ["keyup", "keypress"]) {
    element.addEventListener(type, (event) => event.stopPropagation());
  }
}

export function overlayZIndex() {
  return LAYER_Z_INDEX;
}

export function formatRelativeTime(seconds) {
  const now = Date.now() / 1000;
  const delta = Math.max(0, now - seconds);
  const language = currentLanguage();
  let formatter;
  try {
    formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  } catch (error) {
    formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  }
  const units = [
    ["year", 365 * 86400],
    ["month", 30 * 86400],
    ["week", 7 * 86400],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (delta >= size) {
      return formatter.format(-Math.floor(delta / size), unit);
    }
  }
  return formatter.format(0, "second");
}

export function formatDateTime(seconds) {
  let language = currentLanguage();
  try {
    Intl.DateTimeFormat.supportedLocalesOf(language);
  } catch (error) {
    language = undefined;
  }
  return new Date(seconds * 1000).toLocaleString(language, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function splitPath(filePath) {
  const slash = filePath.lastIndexOf("/");
  return slash < 0
    ? { dir: "", name: filePath }
    : { dir: filePath.slice(0, slash), name: filePath.slice(slash + 1) };
}
