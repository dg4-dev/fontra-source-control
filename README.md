# Fontra Source Control

A [Fontra](https://github.com/fontra/fontra) plugin that brings Git into the glyph editor, similar to VS Code's Source Control view and the Git Graph extension.

- A **Source Control** panel in the left sidebar of the glyph editor: branch, commit message, staged and unstaged changes, merge conflicts and stashes
- Initialize a repository, stage, unstage, discard, commit (amend, commit & push, commit & sync), pull, push, fetch, stash, create, switch and merge branches
- Click a changed file to see the change **graphically**:
  - Glyph files are drawn with the area only the old version covers in red, the area only the new version covers in green and the shared area in gray. Moved nodes are blue. Overlay and side-by-side views use the same colors
  - Kerning files show a table of changed pairs, each drawn at its old and new spacing with the same fill colors
  - Every text file also has a line diff
- A **Git** menu in the menu bar, with a full-window **Git Graph**: the history of all branches in lanes, branch and tag labels, commit details with their changed files (opening the same graphical diff), and operations from context menus: checkout, create branch or tag, merge, rebase, cherry-pick, revert, reset, delete branch or tag
- Colors follow Fontra's light and dark themes
- The UI follows Fontra's display language (Application settings → Display Language), with every language Fontra has a translation for

| Source Control panel | Glyph diff (overlay) |
| --- | --- |
| ![Source Control panel](docs/images/panel.png) | ![Glyph diff, overlay](docs/images/glyph-diff-overlay.png) |
| **Glyph diff (side by side)** | **Kerning diff** |
| ![Glyph diff, side by side](docs/images/glyph-diff-side-by-side.png) | ![Kerning diff](docs/images/kerning-diff.png) |

![Git Graph](docs/images/git-graph.png)

## How it fits together

A Fontra plugin runs in the browser and cannot run git itself. The plugin therefore talks to a small local program, the **git bridge** (`bridge/`), which runs git commands for it. The bridge is a single Node.js script with no dependencies.

```plaintext
Fontra (browser) ── plugin ──HTTP──▶ git bridge (localhost:8765) ──▶ git
```

The bridge finds the repository from the font the editor has open: it runs `git rev-parse --show-toplevel` in the folder that contains the font (the `.ufo`, `.designspace`, `.fontra` or `.glyphs` file or folder). The `.git` folder can therefore be in that folder or any folder above it. "Initialize Repository" creates it in the folder that contains the font.

## Installation

You need [git](https://git-scm.com/) and [Node.js](https://nodejs.org/) 22 or later.

### 1. Start the git bridge

Pass the same folder or font file that Fontra was started with:

```plaintext
npx --yes github:dg4-dev/fontra-source-control /path/to/fonts
```

For Fontra Pak, or Fontra started with `fontra filesystem -`, projects are opened by absolute path; pass `-`:

```plaintext
npx --yes github:dg4-dev/fontra-source-control -
```

From a local copy of this repository:

```plaintext
node bridge/cli.js /path/to/fonts
```

| Option | Description |
| --- | --- |
| `--port N` | Port to listen on (default 8765). Change the plugin's bridge address to match (Git menu → Bridge Settings…) |
| `--host HOST` | Address to listen on (default 127.0.0.1) |
| `--allow-origin URL` | Also accept requests from this origin (repeatable). Pages on `localhost`, `127.0.0.1` and `[::1]` are always accepted |
| `--quiet` | Do not log each request |

Keep the bridge running while you use the plugin. Push and pull use your normal git credentials (credential helper, SSH agent); git is never allowed to ask for a password interactively, so a push that needs one fails with an error message instead of waiting.

### 2. Add the plugin to Fontra

In Fontra, open **Application settings → Plugin Manager**, press "+" and enter the plugin address.

```plaintext
dg4-dev/fontra-source-control
```

Fontra loads `owner/repo` addresses through jsDelivr (`https://cdn.jsdelivr.net/gh/<owner>/<repo>@latest`), so the repository must be public. `@latest` points to the newest release tag, or to the default branch (`main`) when there are no tags.

To try a development branch, enter a URL with the branch name.

```plaintext
https://cdn.jsdelivr.net/gh/dg4-dev/fontra-source-control@develop
```

jsDelivr caches branch contents for a while, so updates may not show up right away.

#### From a local copy (for development)

Serve your working copy with CORS headers and register its URL as the plugin address. Your edits are picked up each time you reopen the editor.

```plaintext
npx http-server /path/to/fontra-source-control -p 8123 --cors -c-1
```

```plaintext
http://localhost:8123
```

After registering, reopen the glyph editor to load the plugin.

## Usage

### Source Control panel

A Source Control tab (branch icon) is added to the left sidebar of the glyph editor.

| Part | Description |
| --- | --- |
| Branch row | Current branch and how far it is ahead (↑) of or behind (↓) its upstream. Click it to switch branches, create a branch or merge. The two buttons pull and push |
| Message box | Commit message. Ctrl+Enter (⌘+Enter) commits |
| Commit button | Commits the staged changes. When nothing is staged, it offers to stage everything (including new files) and commit. The ▾ menu has Commit & Push, Commit & Sync and Commit (Amend) |
| Merge Changes | Files with conflicts. Resolve them, press + (Mark as Resolved), then Continue in the banner above. Abort goes back to the state before the merge, rebase, cherry-pick or revert |
| Staged Changes / Changes | Click a file to see its diff. Hover for stage (+), unstage (−) and discard (↶); right-click for the same actions |
| Stashes | Click a stash to list its files and open their diffs; the buttons apply, pop and drop it |
| ⋯ menu | Pull, push, force push (`--force-with-lease`), fetch, sync, branches, stash, remotes, bridge settings |

The panel checks the repository every few seconds while it is open (Bridge Settings → "Check for changes every few seconds").

Fontra writes edits to disk shortly after they are made, so they show up as changes in the panel. After a pull, checkout, merge or stash changes files on disk, Fontra reloads them for the UFO/designspace and `.fontra` formats, which watch their files.

### Diff view

| Control | Description |
| --- | --- |
| Glyphs / Kerning / Text tabs | The graphical view (when the file is a glyph or kerning file) and the line diff |
| Layer chips | One per layer or source. A dot shows whether the layer was added (green), deleted (red), changed (blue) or not changed (gray) |
| Overlay / Side by side | Overlay draws both versions on top of each other; side by side draws the old version on the left and the new one on the right with the same colors |
| Nodes | Shows nodes and handles. Moved nodes are blue; nodes found only in one version are circled red (old) or green (new) |
| Mouse | Wheel to zoom, drag to pan, double-click to fit. Side-by-side views pan and zoom together |

Supported for graphical diffs:

| Format | Glyphs | Kerning |
| --- | --- | --- |
| UFO (`.ufo`, also inside `.designspace` projects) | `glyphs*/*.glif` | `kerning.plist`, `groups.plist` |
| Fontra (`.fontra`) | `glyphs/*.json` | `kerning.csv` |
| Glyphs (`.glyphs`) | every changed glyph in the file | `kerningLTR` (Glyphs 3), `kerning` (Glyphs 2) |
| Glyphs package (`.glyphspackage`) | `glyphs/*.glyph` | `fontinfo.plist` |

Components are drawn by reading their base glyphs from the same version of the font. For kerning groups, the first glyph of the group is drawn; the table lists all members.

### Git Graph

**Git → Git Graph** in the menu bar (or the graph button in the panel) opens the graph over the whole window. Escape closes it.

- Click a commit to see its message, parents, author and changed files; click a file to open its diff against the first parent
- The top row shows uncommitted changes when there are any
- Right-click a commit: check out, create a branch or tag here, merge into the current branch, rebase the current branch onto it, cherry-pick, revert, reset the current branch to it (soft, mixed or hard), copy its hash or subject
- Right-click a branch or tag label: check out, merge, rebase, rename, delete, push a tag. Double-click a branch label to check it out
- The search box dims commits whose hash, subject or author do not match

### Display language

The plugin reads the display language that Fontra stores in localStorage (`fontra-language-language`) and uses the translation for that language code. Languages without a translation show English. Fontra reloads the page when its display language changes, and the plugin switches language at the same time.

| Language | Translated |
| --- | --- |
| English, 简体中文, 繁體中文, 日本語, Deutsch, Nederlands, Français, Italiano, Español (España), Español (Latinoamérica), Português (Brasil), Português (Portugal), Русский | Yes |
| Tagalog | No (shown in English) |

Terms that also appear in Fontra, such as "component", "anchor", "contour", "layer" and "advance width", follow Fontra's own translations.

## How it works

- **Bridge**: every request is a POST to `/api/<command>` with a JSON body that includes the Fontra project identifier. The bridge maps the identifier to a folder the same way Fontra's filesystem project manager does, opens the repository that contains it, validates every path and revision name, and runs git with an argument list (no shell), `GIT_TERMINAL_PROMPT=0` and literal pathspecs. Commands that change the repository run one at a time per repository
- **Security**: the bridge listens on 127.0.0.1 and only answers requests whose `Host` is a local name (against DNS rebinding) and whose `Origin`, if any, is a local page or one passed with `--allow-origin`. Requests must be `application/json`, so browsers always send a CORS preflight
- **Diffs**: the bridge returns both versions of a file (from a commit, the index or the working tree) and a unified diff made with `git diff --no-index`. Glyph and kerning files are parsed in the browser (`src/formats/`); the fill colors come from SVG masks: the old shape masked by the outside of the new shape is red, the new shape masked by the outside of the old shape is green
- **Graph**: `git log --branches --tags --remotes HEAD --date-order` is laid out in lanes (`src/graph-layout.js`). A lane keeps its column while it lives and freed columns are reused

## Limitations

- The bridge has to be started separately; a browser plugin cannot start programs
- The menu bar menu and the sidebar panel rely on internal APIs of Fontra's editor (`editor.addSidebarPanel()`, the menu bar's item list and others). Changes in Fontra may break them
- Interactive rebase, submodules, worktrees, blame and partial (line-by-line) staging are not supported
- `.glyphspackage` glyph files are found by a guess of their file names (the UFO convention), so components and kerning glyphs may not be drawn for some names
- Fontra's own undo history is not aware of git; after a checkout or pull, undo works on the reloaded glyphs

## Development

```plaintext
plugin.json            Fontra plugin metadata
bridge/
  cli.js               Command line entry point of the git bridge
  server.js            HTTP API, origin and host checks
  repository.js        Git operations and input validation
  git.js               Runs git
  parse.js             Parsers for git's machine-readable output
  project.js           Fontra project identifier → folder
src/
  start.js             Plugin entry point (init / function in plugin.json)
  bridge-client.js     Requests to the bridge, shared repository state
  git-actions.js       Operations with their dialogs and messages
  graph-layout.js      Lane layout of the commit graph
  unified-diff.js      Unified diff parser
  settings.js          Settings store, saved to localStorage
  strings.js           Display language lookup
  lang/                UI strings, one file per Fontra display language
  formats/             Glyph, kerning, plist and XML readers, glyph diff (no Fontra or DOM dependencies)
  ui/                  Sidebar panel, diff view, graph view, menu, drawing and DOM helpers
test/                  Unit tests with node:test; bridge tests run git in temporary repositories
docs/images/           Screenshots
```

Run the tests (Node.js 22 or later and git, no dependencies):

```plaintext
npm test
```

Format with [Prettier](https://prettier.io/) using `.prettierrc.json`.

### Branching

The repository follows git-flow.

- `main`: released code. jsDelivr's `@latest` loads this branch when there are no tags
- `develop`: integration branch for the next release
- `feature/*`: one branch per feature, branched from `develop` and merged back into `develop`
- `release/*`: release preparation, branched from `develop`, merged into both `main` and `develop`, with a tag on `main`

## License

[GNU General Public License v3.0](LICENSE) (GPL-3.0), the same license as Fontra.
