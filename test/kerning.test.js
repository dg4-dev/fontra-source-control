import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diffKerning,
  groupMembers,
  kerningFileKind,
  pairKey,
  parseCSV,
  parseFontraKerning,
  parseGlyphsFileKerning,
  parseUFOKerning,
  representativeGlyph,
} from "../src/formats/kerning.js";

const plist = (body) => `<?xml version="1.0"?><plist version="1.0">${body}</plist>`;

test("UFO kerning with groups", () => {
  const kerning = parseUFOKerning(
    plist(`<dict>
      <key>public.kern1.A</key><dict><key>public.kern2.V</key><integer>-50</integer><key>T</key><integer>-40</integer></dict>
      <key>L</key><dict><key>T</key><real>-60.5</real></dict>
    </dict>`),
    plist(`<dict>
      <key>public.kern1.A</key><array><string>A</string><string>Aacute</string></array>
      <key>public.kern2.V</key><array><string>V</string></array>
      <key>other</key><array><string>x</string></array>
    </dict>`),
    { sourceName: "Bold" }
  );
  assert.deepEqual(kerning.sources, [{ id: "default", name: "Bold" }]);
  assert.deepEqual(kerning.groups1, { A: ["A", "Aacute"] });
  assert.deepEqual(kerning.groups2, { V: ["V"] });
  assert.deepEqual(kerning.pairs.get(pairKey("@A", "@V")).values, { default: -50 });
  assert.deepEqual(kerning.pairs.get(pairKey("L", "T")).values, { default: -60.5 });
  assert.equal(representativeGlyph(kerning, "@A", 1), "A");
  assert.equal(representativeGlyph(kerning, "T", 2), "T");
  assert.equal(representativeGlyph(kerning, "@unknown", 2), "unknown");
  assert.deepEqual(groupMembers(kerning, "@A", 1), ["A", "Aacute"]);
  assert.equal(groupMembers(kerning, "T", 2), null);
});

test("CSV as written by Python's csv module", () => {
  assert.deepEqual(parseCSV('a;"b;c";"d ""e"""\n\n1;2\r\n', ";"), [
    ["a", "b;c", 'd "e"'],
    [],
    ["1", "2"],
  ]);
});

test("Fontra kerning.csv", () => {
  const tables = parseFontraKerning(
    `TYPE
kern

GROUPS1
A;A;Aacute

GROUPS2
O;O;Q

VALUES
side1;side2;light;bold
@A;@O;-20;-30
T;A;;-65
`,
    { sourceNames: { light: "Light" } }
  );
  const kerning = tables.kern;
  assert.deepEqual(kerning.sources, [
    { id: "light", name: "Light" },
    { id: "bold", name: "bold" },
  ]);
  assert.deepEqual(kerning.groups1, { A: ["A", "Aacute"] });
  assert.deepEqual(kerning.groups2, { O: ["O", "Q"] });
  assert.deepEqual(kerning.pairs.get(pairKey("@A", "@O")).values, {
    light: -20,
    bold: -30,
  });
  assert.deepEqual(kerning.pairs.get(pairKey("T", "A")).values, { bold: -65 });
});

test("Glyphs kerning and kerning groups", () => {
  const kerning = parseGlyphsFileKerning(`{
.formatVersion = 3;
fontMaster = ({ id = m1; name = Regular; });
glyphs = (
  { glyphname = A; kernRight = A; },
  { glyphname = Aacute; kernRight = A; },
  { glyphname = V; kernLeft = V; }
);
kerningLTR = { m1 = { "@MMK_L_A" = { "@MMK_R_V" = -60; T = -40; }; }; };
}`);
  assert.deepEqual(kerning.sources, [{ id: "m1", name: "Regular" }]);
  assert.deepEqual(kerning.groups1, { A: ["A", "Aacute"] });
  assert.deepEqual(kerning.groups2, { V: ["V"] });
  assert.deepEqual(kerning.pairs.get(pairKey("@A", "@V")).values, { m1: -60 });
  assert.deepEqual(kerning.pairs.get(pairKey("@A", "T")).values, { m1: -40 });
});

test("kerning diff lists changed values and group membership", () => {
  const before = parseUFOKerning(
    plist(
      `<dict><key>A</key><dict><key>V</key><integer>-50</integer><key>T</key><integer>-40</integer></dict></dict>`
    ),
    plist(
      `<dict><key>public.kern1.O</key><array><string>O</string><string>Q</string></array></dict>`
    )
  );
  const after = parseUFOKerning(
    plist(
      `<dict><key>A</key><dict><key>V</key><integer>-70</integer><key>W</key><integer>-30</integer></dict></dict>`
    ),
    plist(
      `<dict><key>public.kern1.O</key><array><string>O</string><string>D</string></array></dict>`
    )
  );
  const diff = diffKerning(before, after);
  assert.deepEqual(
    diff.pairs.map(({ left, right, old, new: value }) => [left, right, old, value]),
    [
      ["A", "T", -40, null],
      ["A", "V", -50, -70],
      ["A", "W", null, -30],
    ]
  );
  assert.deepEqual(diff.groups, [
    { side: 1, name: "O", added: ["D"], removed: ["Q"], status: "modified" },
  ]);
  // A file that did not exist before
  assert.equal(diffKerning(null, after).pairs.length, 2);
});

test("kerning file kinds", () => {
  assert.equal(kerningFileKind("a/F.ufo/kerning.plist"), "ufo");
  assert.equal(kerningFileKind("F.ufo/groups.plist"), "ufo");
  assert.equal(kerningFileKind("F.fontra/kerning.csv"), "fontra");
  assert.equal(kerningFileKind("F.glyphspackage/fontinfo.plist"), "glyphspackage");
  assert.equal(kerningFileKind("F.glyphs"), "glyphs");
  assert.equal(kerningFileKind("F.ufo/fontinfo.plist"), null);
});
