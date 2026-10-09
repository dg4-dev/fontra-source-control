import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fromDecomposed, transformPoint } from "../src/formats/affine.js";
import { fontraFileName, ufoStyleFileName } from "../src/formats/filenames.js";
import { FontFiles, locateFont, pickLayer } from "../src/formats/font-files.js";
import { changedGlyphNames, diffGlyph, diffPoints } from "../src/formats/glyph-diff.js";
import {
  glyphFileKind,
  parseFontraGlyph,
  parseGlif,
  parseGlyphsFile,
} from "../src/formats/glyph-model.js";
import {
  contourToPathData,
  contoursBounds,
  decomposeSuperBezier,
  flattenComponents,
} from "../src/formats/outline.js";
import { parseOpenStepPlist, parseXMLPlist } from "../src/formats/plist.js";
import { parseXML } from "../src/formats/xml.js";

const fixture = (name) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

test("XML parser reads elements, attributes, entities and CDATA", () => {
  const root = parseXML(
    `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><!-- c --><a x="1 &amp; 2"><b/>t&lt;<![CDATA[<raw>]]></a>`
  );
  assert.equal(root.name, "a");
  assert.equal(root.attributes.x, "1 & 2");
  assert.equal(root.children[0].name, "b");
  assert.equal(root.text, "t<<raw>");
  assert.throws(() => parseXML("<a><b></a>"));
});

test("XML property lists", () => {
  const value = parseXMLPlist(`<?xml version="1.0"?>
    <plist version="1.0"><dict>
      <key>A</key><dict><key>V</key><integer>-50</integer><key>W</key><real>-2.5</real></dict>
      <key>list</key><array><string>a</string><true/></array>
    </dict></plist>`);
  assert.deepEqual(value, { A: { V: -50, W: -2.5 }, list: ["a", true] });
});

test("OpenStep property lists", () => {
  const value = parseOpenStepPlist(`{
    // comment
    name = "Quoted \\"name\\"\\n";
    bare = abc.def;
    nodes = ((10,20,l), (30,40,cs));
    "@MMK_L_A" = { V = -50; };
    data = <0a0b>;
  }`);
  assert.equal(value.name, 'Quoted "name"\n');
  assert.equal(value.bare, "abc.def");
  assert.deepEqual(value.nodes, [
    ["10", "20", "l"],
    ["30", "40", "cs"],
  ]);
  assert.equal(value["@MMK_L_A"].V, "-50");
  assert.equal(value.data, "0a0b");
});

test("UFO .glif files", () => {
  const glyph = parseGlif(fixture("A_.glif"), { layerId: "glyphs", layerName: "Bold" });
  assert.equal(glyph.name, "A");
  assert.deepEqual(glyph.unicodes, [0x41, 0x61]);
  const [layer] = glyph.layers;
  assert.equal(layer.name, "Bold");
  assert.equal(layer.advance, 740);
  assert.equal(layer.contours.length, 4);
  assert.ok(layer.contours.every((c) => c.closed && c.points.every((p) => p.on)));
});

test(".glif off-curve kinds, open contours and components", () => {
  const glyph = parseGlif(`<glyph name="x" format="2"><outline>
    <contour><point x="0" y="0" type="move"/><point x="10" y="10"/><point x="20" y="10"/><point x="30" y="0" type="curve" smooth="yes"/></contour>
    <contour><point x="0" y="0"/><point x="10" y="0"/><point x="10" y="10"/></contour>
    <component base="a" xOffset="100" yScale="2"/>
  </outline><anchor name="top" x="5" y="6"/></glyph>`);
  const [open, quadRing] = glyph.layers[0].contours;
  assert.equal(open.closed, false);
  assert.equal(open.points[1].kind, "cubic");
  assert.equal(open.points[3].smooth, true);
  assert.ok(quadRing.points.every((p) => !p.on && p.kind === "quad"));
  assert.deepEqual(glyph.layers[0].components[0], {
    name: "a",
    transform: [1, 0, 0, 2, 100, 0],
  });
  assert.deepEqual(glyph.layers[0].anchors, [{ name: "top", x: 5, y: 6 }]);
});

test("Fontra glyph JSON", () => {
  const glyph = parseFontraGlyph(fixture("fontra-dieresis.json"), {
    sourceNames: { "bold-condensed": "Bold Condensed" },
  });
  assert.equal(glyph.name, "dieresis");
  const layer = glyph.layers.find((l) => l.id === "bold-condensed");
  assert.equal(layer.name, "Bold Condensed");
  assert.equal(layer.advance, 520);
  assert.equal(layer.components.length, 2);
  assert.deepEqual(layer.components[1].transform, [1, 0, 0, 1, 220, -10]);

  const packed = parseFontraGlyph(
    JSON.stringify({
      name: "p",
      layers: {
        default: {
          glyph: {
            xAdvance: 100,
            path: {
              coordinates: [0, 0, 10, 20, 20, 20, 30, 0],
              pointTypes: [0, 2, 2, 8],
              contourInfo: [{ endPoint: 3, isClosed: false }],
            },
          },
        },
      },
    })
  );
  const contour = packed.layers[0].contours[0];
  assert.equal(contour.closed, false);
  assert.equal(contour.points[1].kind, "cubic");
  assert.equal(contour.points[3].smooth, true);
});

test("Fontra decomposed transforms", () => {
  const t = fromDecomposed({ translateX: 10, translateY: 5, rotation: 90, scaleX: 2 });
  const [x, y] = transformPoint(t, 1, 0);
  assert.ok(Math.abs(x - 10) < 1e-9);
  assert.ok(Math.abs(y - 7) < 1e-9);
});

const GLYPHS3 = `{
.formatVersion = 3;
fontMaster = ({ id = m01; name = Regular; });
glyphs = (
{ glyphname = A; kernRight = A; kernLeft = A; unicode = 65;
  layers = ({ layerId = m01; width = 600; shapes = (
    { closed = 1; nodes = ((0,0,l),(300,700,l),(600,0,l)); },
    { ref = bar; pos = (100,0); }
  ); anchors = ({ name = top; pos = (300,700); }); }); },
{ glyphname = bar; layers = ({ layerId = m01; width = 100; shapes = (
    { closed = 1; nodes = ((0,0,l),(100,0,l),(100,50,l),(0,50,l)); }); }); },
{ glyphname = V; kernLeft = V; layers = ({ layerId = m01; width = 600; }); }
);
kerningLTR = { m01 = { "@MMK_L_A" = { "@MMK_R_V" = -60; T = -40; }; }; };
}`;

const GLYPHS2 = `{
fontMaster = ({ id = "M1"; weight = Bold; });
glyphs = (
{ glyphname = O; unicode = 004F; rightKerningGroup = O;
  layers = ({ layerId = "M1"; width = 500; paths = (
    { closed = 1; nodes = ("0 0 LINE", "10 20 OFFCURVE", "20 20 OFFCURVE", "30 0 CURVE SMOOTH"); }
  ); components = ({ name = A; transform = "{1, 0, 0, 1, 10, 0}"; }); }); }
);
kerning = { M1 = { "@MMK_L_O" = { V = -10; }; }; };
}`;

test("Glyphs 3 files", () => {
  const { glyphs, masters } = parseGlyphsFile(GLYPHS3);
  assert.deepEqual(masters, [{ id: "m01", name: "Regular" }]);
  const a = glyphs.get("A");
  assert.deepEqual(a.unicodes, [65]);
  assert.equal(a.layers[0].name, "Regular");
  assert.equal(a.layers[0].contours[0].points.length, 3);
  assert.deepEqual(a.layers[0].components[0].transform, [1, 0, 0, 1, 100, 0]);
  assert.deepEqual(a.layers[0].anchors, [{ name: "top", x: 300, y: 700 }]);
});

test("Glyphs 2 files", () => {
  const { glyphs, masters } = parseGlyphsFile(GLYPHS2);
  assert.equal(masters[0].name, "Bold");
  const o = glyphs.get("O");
  assert.deepEqual(o.unicodes, [0x4f]);
  const points = o.layers[0].contours[0].points;
  assert.equal(points[1].kind, "cubic");
  assert.equal(points[3].smooth, true);
  assert.deepEqual(o.layers[0].components[0].transform, [1, 0, 0, 1, 10, 0]);
});

test("glyph file kinds", () => {
  assert.equal(glyphFileKind("a/Font.ufo/glyphs/A_.glif"), "glif");
  assert.equal(glyphFileKind("Font.fontra/glyphs/A^1.json"), "fontra");
  assert.equal(glyphFileKind("Font.fontra/font-data.json"), null);
  assert.equal(glyphFileKind("Font.glyphspackage/glyphs/A_.glyph"), "glyphspackage");
  assert.equal(glyphFileKind("Font.glyphs"), "glyphs");
  assert.equal(glyphFileKind("Font.ufo/fontinfo.plist"), null);
});

test("SVG path data", () => {
  const point = (x, y, on = true, kind) => ({ x, y, on, kind, smooth: false });
  assert.equal(
    contourToPathData({
      closed: true,
      points: [point(0, 0), point(10, 0), point(10, 10)],
    }),
    "M0 0 L10 0 L10 10 Z"
  );
  // Starts at the first on-curve point and wraps the leading off-curves
  assert.equal(
    contourToPathData({
      closed: true,
      points: [
        point(0, 10, false, "cubic"),
        point(0, 0),
        point(10, 0, false, "cubic"),
        point(10, 10),
      ],
    }),
    "M0 0 Q10 0 10 10 Q0 10 0 0 Z"
  );
  // Quadratic spline with an implied on-curve point
  assert.equal(
    contourToPathData({
      closed: false,
      points: [
        point(0, 0),
        point(10, 10, false, "quad"),
        point(20, 10, false, "quad"),
        point(30, 0),
      ],
    }),
    "M0 0 Q10 10 15 10 Q20 10 30 0"
  );
  // A ring of quadratic off-curve points only
  assert.match(
    contourToPathData({
      closed: true,
      points: [
        point(0, 0, false, "quad"),
        point(10, 0, false, "quad"),
        point(10, 10, false, "quad"),
      ],
    }),
    /^M5 5 Q/
  );
});

test("super bezier decomposition matches fontTools", () => {
  const segments = decomposeSuperBezier([
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
  ]);
  // fontTools: [((0, 0), (0, 5), (2.5, 7.5)), ((5, 10), (10, 10), (10, 0))]
  assert.deepEqual(
    segments.map((segment) => segment.map((p) => [p.x, p.y])),
    [
      [
        [0, 0],
        [0, 5],
        [2.5, 7.5],
      ],
      [
        [5, 10],
        [10, 10],
        [10, 0],
      ],
    ]
  );
});

test("components are flattened with nested transforms", () => {
  const square = {
    closed: true,
    points: [
      { x: 0, y: 0, on: true },
      { x: 1, y: 0, on: true },
    ],
  };
  const layers = {
    base: { contours: [square], components: [] },
    middle: {
      contours: [],
      components: [{ name: "base", transform: [2, 0, 0, 2, 0, 0] }],
    },
  };
  const top = {
    contours: [],
    components: [
      { name: "middle", transform: [1, 0, 0, 1, 10, 0] },
      { name: "missing", transform: [1, 0, 0, 1, 0, 0] },
    ],
  };
  const { contours, missing } = flattenComponents(top, (name) => layers[name] ?? null);
  // Scaled by the inner component first, then moved by the outer one
  assert.deepEqual(
    contours[0].points.map((p) => [p.x, p.y]),
    [
      [10, 0],
      [12, 0],
    ]
  );
  assert.deepEqual(missing, ["missing"]);
  assert.deepEqual(contoursBounds(contours), { xMin: 10, yMin: 0, xMax: 12, yMax: 0 });
});

test("glyph diff: moved points, advance, components and anchors", () => {
  const base = parseGlif(fixture("A_.glif"), { layerId: "glyphs" });
  const changed = parseGlif(
    fixture("A_.glif")
      .replace('<advance width="740"/>', '<advance width="760"/>')
      .replace(
        '<point x="110" y="120" type="line"/>',
        '<point x="110" y="100" type="line"/>'
      )
      .replace("<outline>", '<outline><component base="acute" xOffset="10"/>')
      .replace('<unicode hex="0061"/>', ""),
    { layerId: "glyphs" }
  );
  const diff = diffGlyph(base, changed);
  assert.equal(diff.changed, true);
  assert.deepEqual(diff.unicodes, { old: [0x41, 0x61], new: [0x41] });
  const [layer] = diff.layers;
  assert.equal(layer.status, "modified");
  assert.deepEqual(
    layer.changes.map((c) => c.type),
    ["advance", "pointsMoved", "components"]
  );
  assert.deepEqual(layer.points.moved, [
    {
      contour: 1,
      point: 0,
      from: { x: 110, y: 120 },
      to: { x: 110, y: 100 },
      on: true,
    },
  ]);
  assert.deepEqual(layer.changes[2].added, ["acute"]);

  const same = diffGlyph(base, parseGlif(fixture("A_.glif"), { layerId: "glyphs" }));
  assert.equal(same.changed, false);
  assert.equal(diffGlyph(null, base).layers[0].status, "added");
  assert.equal(diffGlyph(base, null).status, "removed");
});

test("point diff with a changed structure reports added and removed points", () => {
  const contour = (...coordinates) => ({
    closed: true,
    points: coordinates.map(([x, y]) => ({ x, y, on: true })),
  });
  const result = diffPoints(
    [contour([0, 0], [1, 0], [1, 1])],
    [contour([0, 0], [1, 0], [2, 2], [1, 1])]
  );
  assert.equal(result.sameStructure, false);
  assert.deepEqual(result.added, [{ x: 2, y: 2, on: true }]);
  assert.deepEqual(result.removed, []);
});

test("changed glyphs in whole-font files", () => {
  const before = parseGlyphsFile(GLYPHS3).glyphs;
  const after = parseGlyphsFile(GLYPHS3.replace("width = 100;", "width = 120;")).glyphs;
  assert.deepEqual(changedGlyphNames(before, after), ["bar"]);
});

test("Fontra glyph file names match fontra/backends/filenames.py", () => {
  // Expected values produced by Fontra's stringToFileName
  const expected = {
    "C": "C^1",
    "dieresis": "dieresis",
    "A.alt": "A.alt^1",
    "con": "con^0",
    "a/b": "a%2Fb",
    "^x": "%5Ex",
    "ABCDEFG": "ABCDEFG^V3",
    ".notdef": "%2Enotdef",
    "é": "é",
  };
  for (const [name, fileName] of Object.entries(expected)) {
    assert.equal(fontraFileName(name), fileName, name);
  }
  assert.equal(ufoStyleFileName("A"), "A_");
  assert.equal(ufoStyleFileName("a.alt"), "a.alt");
  assert.equal(ufoStyleFileName("con"), "_con");
});

test("font locations", () => {
  assert.deepEqual(locateFont("fonts/Bold.ufo/glyphs/A_.glif"), {
    format: "ufo",
    fontPath: "fonts/Bold.ufo",
  });
  assert.deepEqual(locateFont("X.fontra/kerning.csv"), {
    format: "fontra",
    fontPath: "X.fontra",
  });
  assert.deepEqual(locateFont("a/X.glyphs"), {
    format: "glyphs",
    fontPath: "a/X.glyphs",
  });
  assert.equal(locateFont("README.md"), null);
});

test("FontFiles resolves components and kerning glyphs in a UFO", async () => {
  const files = {
    "F.ufo/glyphs/contents.plist": `<plist><dict><key>A</key><string>A_.glif</string><key>acute</key><string>acute.glif</string><key>Aacute</key><string>A_acute.glif</string></dict></plist>`,
    "F.ufo/glyphs/A_.glif": fixture("A_.glif"),
    "F.ufo/glyphs/acute.glif": `<glyph name="acute"><advance width="200"/><outline><contour><point x="0" y="800" type="line"/><point x="100" y="900" type="line"/><point x="50" y="800" type="line"/></contour></outline></glyph>`,
    "F.ufo/glyphs/A_acute.glif": `<glyph name="Aacute"><advance width="740"/><outline><component base="A"/><component base="acute" xOffset="300"/></outline></glyph>`,
    "F.ufo/kerning.plist": `<plist><dict><key>public.kern1.A</key><dict><key>V</key><integer>-50</integer></dict></dict></plist>`,
    "F.ufo/groups.plist": `<plist><dict><key>public.kern1.A</key><array><string>Aacute</string><string>A</string></array></dict></plist>`,
  };
  const reads = [];
  const fontFiles = new FontFiles(async (rev, path) => {
    reads.push(path);
    return files[path] ?? null;
  }, "F.ufo/glyphs/A_acute.glif");
  const glyphs = await fontFiles.glyphsInFile("HEAD");
  const glyph = glyphs.get("Aacute");
  const { contours, missing } = await fontFiles.componentContours(
    "HEAD",
    glyph,
    glyph.layers[0]
  );
  assert.equal(contours.length, 5);
  assert.deepEqual(missing, []);
  assert.equal(contours[4].points[0].x, 300);

  const kerning = await fontFiles.kerning("HEAD");
  assert.deepEqual(
    [...kerning.pairs.values()],
    [{ left: "@A", right: "V", values: { default: -50 } }]
  );
  assert.equal(kerning.sources[0].name, "F");
  // contents.plist is read once and cached
  assert.equal(reads.filter((p) => p.endsWith("contents.plist")).length, 1);
});

test("layer picking by layer id and font source", () => {
  const glyph = {
    layers: [{ id: "light" }, { id: "bold-layer" }],
    sources: [{ layerName: "bold-layer", locationBase: "bold" }],
  };
  assert.equal(pickLayer(glyph, { layerId: "light" }).id, "light");
  assert.equal(pickLayer(glyph, { sourceId: "bold" }).id, "bold-layer");
  assert.equal(pickLayer(glyph, { layerId: "nope" }).id, "light");
});
