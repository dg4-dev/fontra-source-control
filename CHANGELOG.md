# Changelog

Each section can be pasted as the notes of the matching GitHub release.

## 0.1.0

The first release: Git for Fontra's glyph editor, with a Source Control panel, graphical glyph and kerning diffs, and a Git Graph.

### What it does

- **Source Control panel** in the left sidebar of the glyph editor (branch icon): see what changed, stage, commit, pull, push, fetch, stash, create and switch branches, merge, and resolve merge conflicts. If the font's folder is not a repository yet, one button creates it
- **Graphical diffs**: click a changed file to see it drawn
  - Glyphs: the area only the old version covers is red, the area only the new version covers is green, the shared area is gray, and moved nodes are blue. Overlay or side by side, with the same colors on both sides
  - Kerning: every changed pair, drawn at its old and new spacing in the same colors, with the values and the difference
  - Works with UFO / designspace, `.fontra`, `.glyphs` and `.glyphspackage` fonts. Every text file also has a line diff
- **Git Graph** (Git menu in the menu bar): the history of all branches. Click a commit to see its changes; right-click to check out, branch, tag, merge, rebase, cherry-pick, revert or reset
- Follows Fontra's light and dark themes and its display language (English, 简体中文, 繁體中文, 日本語, Deutsch, Nederlands, Français, Italiano, Español, Português, Русский)

### Before you install

The plugin needs a small helper program, the **git bridge**, running on your computer while you use it. A plugin runs inside the browser, and the browser does not let it run git directly; the bridge runs git on its behalf. You need:

- [git](https://git-scm.com/downloads)
- [Node.js](https://nodejs.org/) 22 or later (the "LTS" installer)

Check them in a terminal with `git --version` and `node --version`.

### Setup

1. **Start the git bridge.** Open a terminal (macOS: Applications → Utilities → Terminal; Windows: PowerShell), paste this command and press Return:

   ```plaintext
   npx --yes github:dg4-dev/fontra-source-control#v0.1.0
   ```

   It prints `Fontra git bridge is running on http://localhost:8765`. Keep the window open while you use Fontra, and run the same command again the next time. No folder needs to be given: the bridge works with whatever font Fontra opens.

2. **Add the plugin.** In Fontra, choose **Fontra → Plugin Manager** in the menu bar, press "+" and enter `dg4-dev/fontra-source-control`. Then open a font in the glyph editor.

3. **Open the panel.** Click the branch icon in the left sidebar. If the folder that contains the font is not a git repository yet, press **Initialize Repository**. The repository can also be in a folder above the font; for example a `.git` folder next to a `.fontra` or `.designspace` file is found.

4. **(Optional) Push to GitHub.** Create an empty repository on GitHub, choose ⋯ → Add Remote… in the panel and paste its URL, then press the push button. The bridge cannot ask for a password, so make sure `git push` works from a terminal on this computer first (for example with `gh auth login` from GitHub CLI, GitHub Desktop or an SSH key).

See the [README](https://github.com/dg4-dev/fontra-source-control#setup) for options and troubleshooting.

### Known limitations

- The bridge has to be started by hand each time; Fontra has no way for plugins to start programs
- Tested with Fontra started from the command line; Fontra Pak has not been tested
- The menu bar menu and the sidebar panel use internal parts of Fontra's editor and may need an update when Fontra changes
- Interactive rebase, submodules and staging individual lines are not supported

### 日本語

Fontra のグリフエディターで Git を使えるようにするプラグインの最初のリリースです。

**できること**

- **ソース管理パネル**(グリフエディターの左サイドバー、枝分かれのアイコン): 変更の確認、ステージ、コミット、プル、プッシュ、フェッチ、スタッシュ、ブランチの作成・切り替え・マージ、競合の解決ができます。フォントのフォルダーがまだリポジトリでなければ、ボタン 1 つで作成できます
- **差分の図示**: 変更されたファイルをクリックすると、図で表示します
  - グリフ: 変更前だけにある部分を赤、変更後だけにある部分を緑、共通部分を灰色で塗り、動いたノードを青で示します。重ねる表示と並べる表示があり、どちらも同じ色の意味です
  - カーニング: 変わったペアを、変更前と変更後の間隔で同じ色を使って描き、値と差を表に並べます
  - UFO / designspace、`.fontra`、`.glyphs`、`.glyphspackage` に対応しています。テキストのファイルは行ごとの差分も見られます
- **Git グラフ**(メニューバーの「Git」): すべてのブランチの履歴を表示します。コミットをクリックすると変更を表示し、右クリックでチェックアウト、ブランチやタグの作成、マージ、リベース、チェリーピック、リバート、リセットができます
- Fontra のライト/ダークテーマと表示言語に合わせて表示します

**入れる前に**

このプラグインを使っている間は、手元のコンピューターで小さな補助プログラム(**Git ブリッジ**)を動かしておく必要があります。プラグインはブラウザの中で動くため、git を直接実行できません。代わりにブリッジが git を実行します。次の 2 つが必要です。

- [git](https://git-scm.com/downloads)
- [Node.js](https://nodejs.org/) 22 以降(「LTS」のインストーラー)

ターミナルで `git --version` と `node --version` を実行し、バージョン番号が表示されれば入っています。

**使い始める手順**

1. **Git ブリッジを起動します。** ターミナル(macOS: アプリケーション → ユーティリティ → ターミナル、Windows: PowerShell)を開き、次のコマンドを貼り付けて Return キーを押します。

   ```plaintext
   npx --yes github:dg4-dev/fontra-source-control#v0.1.0
   ```

   `Fontra git bridge is running on http://localhost:8765` と表示されたら起動しています。Fontra を使っている間はこのウィンドウを開いたままにし、次に使うときも同じコマンドを実行します。フォルダーを指定する必要はありません。ブリッジは Fontra で開いたフォントに合わせて動きます。

2. **プラグインを追加します。** Fontra のメニューバーの「Fontra」→「プラグインマネージャー」を開いて「+」を押し、`dg4-dev/fontra-source-control` を入力します。そのあと、グリフエディターでフォントを開きます。

3. **パネルを開きます。** 左サイドバーの枝分かれのアイコンをクリックします。フォントのあるフォルダーがまだ Git リポジトリでなければ、「リポジトリを初期化する」を押します。リポジトリはフォントより上のフォルダーにあっても構いません。たとえば `.fontra` や `.designspace` と同じフォルダーにある `.git` を見つけます。

4. **(必要なら)GitHub にプッシュします。** GitHub で空のリポジトリを作り、パネルの「⋯ → リモートを追加…」でその URL を貼り付けて、プッシュのボタンを押します。ブリッジはパスワードを尋ねられないので、先にこのコンピューターのターミナルで `git push` ができる状態にしておいてください(GitHub CLI の `gh auth login`、GitHub Desktop、SSH キーのいずれか)。

オプションや困ったときの対処は [README](https://github.com/dg4-dev/fontra-source-control#setup) を見てください。

**制限**

- ブリッジは使うたびに手で起動する必要があります。Fontra には、プラグインからほかのプログラムを起動する仕組みがありません
- コマンドラインから起動した Fontra で確認しています。Fontra Pak ではまだ確認していません
- メニューバーのメニューとサイドバーのパネルは Fontra 内部の仕組みを使っているため、Fontra の更新に合わせて直す必要が出ることがあります
- 対話的なリベース、サブモジュール、行単位のステージには対応していません
