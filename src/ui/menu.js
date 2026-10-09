// Adds a "Git" menu to the glyph editor's menu bar, before the Help menu.
// Fontra's MenuBar has no public way to add menus, so the plugin appends an
// item to its item list and asks it to redraw.

import { t } from "../strings.js";

export function addMenuBarMenu({ state, actions, openGraph, openPanel }) {
  const menuBar = document.querySelector(".top-bar-container menu-bar");
  if (
    !menuBar ||
    !Array.isArray(menuBar.items) ||
    typeof menuBar.render !== "function"
  ) {
    console.warn("[source-control] the menu bar could not be found; no Git menu added");
    return false;
  }
  const repo = () => !!state.status?.initialized;
  const idle = () => repo() && !state.busy;
  const menu = {
    title: t("menubar.git"),
    getItems: () => {
      // Opening the menu is a good moment to bring the status up to date
      state.refresh();
      return [
        {
          title: t("action.openGraph"),
          enabled: () => true,
          callback: () => openGraph(),
        },
        {
          title: t("action.openPanel"),
          enabled: () => true,
          callback: () => openPanel(),
        },
        { title: "-" },
        {
          title: t("action.commitEllipsis"),
          enabled: idle,
          callback: () => openPanel(true),
        },
        { title: t("action.pull"), enabled: idle, callback: () => actions.pull() },
        { title: t("action.push"), enabled: idle, callback: () => actions.push() },
        { title: t("action.fetch"), enabled: idle, callback: () => actions.fetch() },
        { title: "-" },
        {
          title: t("action.createBranch"),
          enabled: idle,
          callback: () => actions.createBranch(),
        },
        {
          title: t("action.switchBranch"),
          enabled: idle,
          callback: () => actions.switchBranch(),
        },
        {
          title: t("action.merge"),
          enabled: idle,
          callback: () => actions.mergeBranch(),
        },
        { title: t("action.stash"), enabled: idle, callback: () => actions.stash() },
        { title: "-" },
        {
          title: t("action.init"),
          enabled: () => state.status?.initialized === false && !state.busy,
          callback: () => actions.init(),
        },
        {
          title: t("action.bridgeSettings"),
          enabled: () => true,
          callback: () => actions.bridgeSettings(),
        },
      ];
    },
  };
  const helpIndex = Math.max(0, menuBar.items.length - 1);
  menuBar.items.splice(helpIndex, 0, menu);
  menuBar.contentElement.replaceChildren();
  menuBar.render();
  return true;
}
