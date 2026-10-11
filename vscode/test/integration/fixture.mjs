// A small UFO in a git repository: one commit, then uncommitted changes to
// a glyph, a glyph with components and the kerning
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runGit } from "../../../bridge/git.js";

const plist = (body) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n${body}\n</plist>\n`;

function glif(name, advance, outline) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<glyph name="${name}" format="2">\n  <advance width="${advance}"/>\n  <outline>\n${outline}\n  </outline>\n</glyph>\n`;
}

function box(x0, y0, x1, y1) {
  return `    <contour>\n      <point x="${x0}" y="${y0}" type="line"/>\n      <point x="${x0}" y="${y1}" type="line"/>\n      <point x="${x1}" y="${y1}" type="line"/>\n      <point x="${x1}" y="${y0}" type="line"/>\n    </contour>`;
}

export async function makeFixture(folder) {
  const ufo = path.join(folder, "Demo.ufo");
  mkdirSync(path.join(ufo, "glyphs"), { recursive: true });
  const write = (file, text) => writeFileSync(path.join(ufo, file), text);
  const env = {
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  write(
    "metainfo.plist",
    plist("<dict><key>formatVersion</key><integer>3</integer></dict>")
  );
  write(
    "glyphs/contents.plist",
    plist(
      "<dict><key>A</key><string>A_.glif</string><key>O</key><string>O_.glif</string>" +
        "<key>Aacute</key><string>A_acute.glif</string><key>acutecomb</key><string>acutecomb.glif</string></dict>"
    )
  );
  write("glyphs/A_.glif", glif("A", 600, box(50, 0, 550, 700)));
  write("glyphs/O_.glif", glif("O", 600, box(50, 0, 550, 700)));
  write("glyphs/acutecomb.glif", glif("acutecomb", 0, box(-30, 750, 30, 900)));
  write(
    "glyphs/A_acute.glif",
    glif(
      "Aacute",
      600,
      '    <component base="A"/>\n    <component base="acutecomb" xOffset="300"/>'
    )
  );
  const kerning = (value) =>
    plist(
      `<dict><key>A</key><dict><key>O</key><integer>${value}</integer></dict></dict>`
    );
  write("kerning.plist", kerning(-20));
  write(
    "fontinfo.plist",
    plist("<dict><key>unitsPerEm</key><integer>1000</integer></dict>")
  );
  const git = (args) => runGit(args, { cwd: folder, env });
  await git(["init", "-q", "-b", "main"]);
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "First version"]);
  write("glyphs/A_.glif", glif("A", 640, box(60, 0, 580, 720)));
  write("glyphs/O_.glif", glif("O", 600, box(40, 0, 560, 700)));
  write("glyphs/A_acute.glif", glif("Aacute", 600, '    <component base="A"/>'));
  write("kerning.plist", kerning(-50));
  return folder;
}
