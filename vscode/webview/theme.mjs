// Maps VS Code's theme colors onto the variables the Fontra plugin's views
// read, so the views follow the editor's color theme.

import { themeColorCSS } from "../../src/ui/dom.js";

// Page level: the variables Fontra's own stylesheet would define. The views
// tell light from dark with --fontra-theme-marker, which Fontra defines (as
// an empty value) only in light themes.
export const pageCSS = `
  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    overflow: hidden;
  }
  body {
    --fontra-theme-marker: initial;
    --ui-element-foreground-color: var(--vscode-foreground);
    --foreground-color: var(--vscode-editor-foreground);
    --background-color: var(--vscode-editor-background);
    --ui-element-background-color: var(--vscode-editor-background);
    --text-input-background-color: var(--vscode-input-background);
    --text-input-foreground-color: var(--vscode-input-foreground);
    --horizontal-rule-color: var(--vscode-editorGroup-border, #8884);
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
  }
  body.vscode-light, body.vscode-high-contrast-light {
    --fontra-theme-marker: ;
  }
`;

// Inside the views' shadow roots, after their own styles: VS Code's colors
// for buttons, lists and text instead of Fontra's
export const viewCSS = `
  ${themeColorCSS({
    "sc-preview-fill": ["#00000024", "#ffffff2e"],
    "sc-component-fill": ["#1f6feb2b", "#58a6ff3a"],
  })}
  :host {
    --sc-accent: var(--vscode-button-background);
    --sc-accent-foreground: var(--vscode-button-foreground);
    --sc-button: var(--vscode-button-secondaryBackground);
    --sc-button-hover: var(--vscode-button-secondaryHoverBackground);
    --sc-hover: var(--vscode-list-hoverBackground);
    --sc-selected: var(--vscode-list-inactiveSelectionBackground);
    --sc-muted: var(--vscode-descriptionForeground);
    --sc-border: var(--vscode-editorGroup-border, #8884);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  .segmented button:not(.active), .chip:not(.selected) {
    color: var(--vscode-button-secondaryForeground, inherit);
  }
  input[type="text"], select {
    border: 1px solid var(--vscode-input-border, transparent);
  }
  [hidden] {
    display: none !important;
  }
`;
