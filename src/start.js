// Fontra plugin entry point. Fontra imports this module and calls
// start(editor, pluginPath) once the glyph editor has been set up.

import { BridgeClient, GitState } from "./bridge-client.js";
import { GitActions, showError } from "./git-actions.js";
import { SourceControlSettings } from "./settings.js";
import { t } from "./strings.js";
import { DiffView } from "./ui/diff-view.js";
import { showMenu } from "./ui/dom.js";
import { GraphView } from "./ui/graph-view.js";
import { addMenuBarMenu } from "./ui/menu.js";
import { PANEL_IDENTIFIER, definePanelElement } from "./ui/panel.js";

export function start(editor, pluginPath) {
  const projectIdentifier =
    editor.projectIdentifier ?? new URL(window.location).searchParams.get("project");
  if (!projectIdentifier) {
    console.error("[source-control] could not find the project identifier");
    return;
  }

  const settings = new SourceControlSettings();
  const client = new BridgeClient(settings, fontPath(editor, projectIdentifier));
  const state = new GitState(client, settings);
  const actions = new GitActions(state, settings);

  const openDiff = (request) => DiffView.open({ client, settings, request });
  const graph = new GraphView({ state, actions, openDiff });
  const openGraph = () => graph.open();
  // Lists a stash's files; picking one opens its diff
  const openStash = async (stash, anchor) => {
    let details;
    try {
      details = await client.call("stashDetails", { index: stash.index });
    } catch (error) {
      showError(error);
      return;
    }
    showMenu(
      [
        { heading: `stash@{${stash.index}} · ${stash.subject}`.slice(0, 70) },
        ...details.files.map((file) => ({
          label: file.path,
          detail: file.status === "?" ? "U" : file.status,
          onSelect: () =>
            openDiff({
              path: file.path,
              oldPath: file.origPath ?? null,
              from: file.status === "A" ? "EMPTY" : file.from,
              to: file.status === "D" ? "EMPTY" : file.to,
              fromLabel: file.status === "?" ? "" : "HEAD",
              toLabel: `stash@{${stash.index}}`,
              status: file.status,
            }),
        })),
        "-",
        {
          label: t("action.stashApply"),
          onSelect: () => actions.stashApply(stash.index, false),
        },
        {
          label: t("action.stashPop"),
          onSelect: () => actions.stashApply(stash.index, true),
        },
        {
          label: t("action.stashDrop"),
          danger: true,
          onSelect: () => actions.stashDrop(stash.index),
        },
      ],
      anchor
    );
  };

  const panel = addPanel(editor, pluginPath, {
    state,
    actions,
    openDiff,
    openGraph,
    openStash,
  });
  const openPanel = (focusMessage = false) => {
    if (!panel) {
      return;
    }
    const tab = document.querySelector(
      `.sidebar-tab[data-sidebar-name="${PANEL_IDENTIFIER}"]`
    );
    if (!tab?.classList.contains("selected")) {
      editor.toggleSidebar(PANEL_IDENTIFIER, true);
    }
    if (focusMessage) {
      panel.focusMessage();
    }
  };
  addMenuBarMenu({ state, actions, openGraph, openPanel });
  state.refresh();
}

// The font's absolute path, so the bridge needs no folder to start with.
// Fontra's filesystem project manager reports it through getMetaInfo(); when
// that is not available, the editor URL's project identifier is used instead.
async function fontPath(editor, projectIdentifier) {
  try {
    const metaInfo = await editor.fontController?.font?.getMetaInfo?.();
    const path = metaInfo?.projectIdentifier;
    if (typeof path === "string" && /^([/\\]|[A-Za-z]:[/\\])/.test(path)) {
      return path;
    }
  } catch (error) {
    console.warn("[source-control] could not get the font's path from Fontra", error);
  }
  return projectIdentifier;
}

function addPanel(editor, pluginPath, options) {
  if (typeof editor.addSidebarPanel !== "function") {
    console.warn("[source-control] sidebar panels are not supported by this Fontra");
    return null;
  }
  const PanelElement = definePanelElement();
  const panel = new PanelElement({ ...options, iconPath: `${pluginPath}/icon.svg` });
  try {
    editor.addSidebarPanel(panel, "left");
  } catch (e) {
    console.error("[source-control] could not add sidebar panel", e);
    return null;
  }
  // Fontra looks up the tab tooltip in its own translation table, which does
  // not know about plugins; set it directly.
  const tab = document.querySelector(
    `.sidebar-tab[data-sidebar-name="${PANEL_IDENTIFIER}"]`
  );
  tab?.setAttribute("title", t("sidebar.tab"));
  return panel;
}
