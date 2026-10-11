// Webview panels that show the Fontra plugin's diff view, or a preview of a
// glyph or kerning file. The page (webview/main.mjs) asks for file contents
// through messages; each panel answers them with its own reader.

import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

const VIEW_TYPE = "fontraPreview.view";
const SETTINGS_SECTION = "fontraPreview";
const SETTING_KEYS = ["glyphDiffMode", "showPoints"];

export function readSettings() {
  const config = vscode.workspace.getConfiguration(SETTINGS_SECTION);
  return Object.fromEntries(SETTING_KEYS.map((key) => [key, config.get(key)]));
}

export class FontPanel {
  // column: a ViewColumn, or { viewColumn, preserveFocus }
  // init: the first message for the page ({ mode, ... })
  // handlers: { method: async (params) => result } for the page's requests
  constructor(context, { title, column, init, handlers, onDispose }) {
    this.handlers = handlers;
    this.init = init;
    this.ready = false;
    this.requestCount = 0;
    this.disposables = [];
    this.panel = vscode.window.createWebviewPanel(VIEW_TYPE, title, column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
    });
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "dist", "icon.svg");
    this.panel.webview.html = pageHTML(this.panel.webview, context.extensionUri);
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message) => this._onMessage(message)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(SETTINGS_SECTION)) {
          this.post({ type: "settings", settings: readSettings() });
        }
      })
    );
    this.panel.onDidDispose(() => {
      for (const disposable of this.disposables) {
        disposable.dispose();
      }
      onDispose?.();
    });
  }

  post(message) {
    if (this.ready) {
      this.panel.webview.postMessage(message);
    }
  }

  // Shows the panel where it is
  reveal() {
    this.panel.reveal(undefined, true);
  }

  async _onMessage(message) {
    switch (message?.type) {
      case "ready":
        this.ready = true;
        this.panel.webview.postMessage({
          type: "init",
          language: vscode.env.language,
          settings: readSettings(),
          ...this.init,
        });
        break;
      case "request": {
        const handler = this.handlers[message.method];
        this.requestCount++;
        try {
          if (!handler) {
            throw new Error(`unknown request: ${message.method}`);
          }
          const result = await handler(message.params ?? {});
          this.panel.webview.postMessage({ type: "response", id: message.id, result });
        } catch (error) {
          this.panel.webview.postMessage({
            type: "response",
            id: message.id,
            error: error?.message ?? String(error),
          });
        }
        break;
      }
      case "setting":
        if (SETTING_KEYS.includes(message.key)) {
          await vscode.workspace
            .getConfiguration(SETTINGS_SECTION)
            .update(message.key, message.value, vscode.ConfigurationTarget.Global);
        }
        break;
    }
  }
}

function pageHTML(webview, extensionUri) {
  const nonce = randomBytes(16).toString("base64");
  const script = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview.js")
  );
  // The diff view builds its styles in <style> elements inside shadow roots,
  // which need 'unsafe-inline' for styles. Scripts only run with the nonce.
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
