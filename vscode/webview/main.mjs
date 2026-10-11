// Page script of the extension's webview panels. Shows the Fontra plugin's
// diff view, or a preview of a glyph or kerning file, and reads files through
// messages to the extension.

import { setLanguage } from "../../src/strings.js";
import { DiffView } from "../../src/ui/diff-view.js";
import { el } from "../../src/ui/dom.js";
import { PreviewView } from "./preview-view.mjs";
import { pageCSS, viewCSS } from "./theme.mjs";

// eslint-disable-next-line no-undef
const vscode = acquireVsCodeApi();

let nextRequestId = 1;
const pendingRequests = new Map();

function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++;
    pendingRequests.set(id, { resolve, reject });
    vscode.postMessage({ type: "request", id, method, params });
  });
}

// Same interface as the plugin's BridgeClient
const client = {
  call: (command, params) => request(command, params),
  readText: (rev, path) => request("readText", { rev, path }),
};

// Same interface as the plugin's settings store, saved in VS Code's settings
class Settings {
  constructor(values) {
    this.values = { ...values };
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    if (this.values[key] === value) {
      return;
    }
    this.values[key] = value;
    vscode.postMessage({ type: "setting", key, value });
  }
}

let settings = null;
let init = null;
let view = null;

function start(message) {
  init = message;
  setLanguage(message.language);
  settings = new Settings(message.settings);
  document.head.append(el("style", {}, pageCSS));
  if (message.mode === "preview") {
    view = new PreviewView({
      client,
      settings,
      path: message.path,
      displayPath: message.displayPath,
      text: message.text,
      extraCSS: viewCSS,
    });
    view.show();
  } else {
    showDiff();
  }
}

// A new diff view for the same files, keeping the tab and the glyph and layer
// shown by the previous one
function showDiff() {
  const previous = view;
  view = new DiffView({
    client,
    settings,
    request: init.request,
    embedded: true,
    extraCSS: viewCSS,
  });
  if (previous) {
    if (view.tabs.some((tab) => tab.id === previous.activeTab)) {
      view.activeTab = previous.activeTab;
    }
    view.glyphState = previous.glyphState;
  }
  view.show();
  previous?.close();
}

window.addEventListener("message", (event) => {
  const message = event.data;
  switch (message?.type) {
    case "init":
      if (!init) {
        start(message);
      }
      break;
    case "response": {
      const pending = pendingRequests.get(message.id);
      if (pending) {
        pendingRequests.delete(message.id);
        if (message.error !== undefined) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message.result);
        }
      }
      break;
    }
    case "update":
      view?.update?.(message.text);
      break;
    case "refresh":
      if (init?.mode === "diff") {
        showDiff();
      } else {
        view?.refresh();
      }
      break;
    case "settings":
      if (settings) {
        settings.values = { ...message.settings };
        view?.refresh?.();
      }
      break;
  }
});

vscode.postMessage({ type: "ready" });
