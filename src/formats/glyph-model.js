// Reads glyph outlines from the file formats Fontra works with into one model:
//
//   Glyph   { name, unicodes: number[], layers: Layer[] }
//   Layer   { id, name, advance, contours: Contour[], components: Component[],
//             anchors: { name, x, y }[] }
//   Contour { closed, points: Point[] }
//   Point   { x, y, on, kind ("cubic" | "quad", off-curve points only), smooth }
//   Component { name, transform: [xx, xy, yx, yy, dx, dy] }
//
// Supported: UFO .glif, Fontra .fontra glyph JSON, and glyph entries from
// .glyphs / .glyphspackage files (Glyphs 2 and 3).

import { IDENTITY, fromDecomposed, rotate, scale, skew, translate } from "./affine.js";
import { parseOpenStepPlist } from "./plist.js";
import { childElements, firstChild, parseXML } from "./xml.js";

// --- UFO ----------------------------------------------------------------------

export function parseGlif(text, { layerId = "foreground", layerName = null } = {}) {
  const root = parseXML(text);
  if (root.name !== "glyph") {
    throw new Error("not a .glif file");
  }
  const advanceElement = firstChild(root, "advance");
  const advance = advanceElement ? number(advanceElement.attributes.width, 0) : 0;
  const unicodes = childElements(root, "unicode")
    .map((element) => parseInt(element.attributes.hex, 16))
    .filter(Number.isFinite);

  const contours = [];
  const components = [];
  const outline = firstChild(root, "outline");
  for (const element of outline?.children ?? []) {
    if (element.name === "contour") {
      contours.push(glifContour(element));
    } else if (element.name === "component") {
      const a = element.attributes;
      components.push({
        name: a.base ?? "",
        transform: [
          number(a.xScale, 1),
          number(a.xyScale, 0),
          number(a.yxScale, 0),
          number(a.yScale, 1),
          number(a.xOffset, 0),
          number(a.yOffset, 0),
        ],
      });
    }
  }
  const anchors = childElements(root, "anchor").map((element) => ({
    name: element.attributes.name ?? "",
    x: number(element.attributes.x, 0),
    y: number(element.attributes.y, 0),
  }));

  return {
    name: root.attributes.name ?? "",
    unicodes,
    layers: [
      {
        id: layerId,
        name: layerName ?? layerId,
        advance,
        contours,
        components,
        anchors,
      },
    ],
  };
}

function glifContour(element) {
  const raw = childElements(element, "point").map((point) => ({
    x: number(point.attributes.x, 0),
    y: number(point.attributes.y, 0),
    type: point.attributes.type ?? "offcurve",
    smooth: point.attributes.smooth === "yes",
  }));
  const closed = !(raw.length && raw[0].type === "move");
  return {
    closed,
    points: assignOffCurveKinds(
      raw.map((p) => ({
        x: p.x,
        y: p.y,
        on: p.type !== "offcurve",
        segment: p.type === "qcurve" ? "quad" : p.type === "curve" ? "cubic" : null,
        smooth: p.smooth,
      })),
      closed,
      "quad" // a closed contour of only off-curve points is a TrueType quad ring
    ),
  };
}

// Off-curve points take their kind from the on-curve point that ends their
// segment. Points are { x, y, on, segment, smooth } where segment is the kind
// of curve an on-curve point ends ("cubic", "quad" or null for lines).
function assignOffCurveKinds(points, closed, fallbackKind) {
  const count = points.length;
  const result = points.map((p) => ({ x: p.x, y: p.y, on: p.on, smooth: p.smooth }));
  for (let i = 0; i < count; i++) {
    if (points[i].on) {
      continue;
    }
    let kind = null;
    for (let step = 1; step <= count; step++) {
      const j = i + step;
      if (!closed && j >= count) {
        break;
      }
      const candidate = points[j % count];
      if (candidate.on) {
        kind = candidate.segment;
        break;
      }
    }
    result[i].kind = kind ?? fallbackKind;
  }
  return result;
}

// UFO's layer folder names: "glyphs" is the default layer
export function ufoLayerFromPath(filePath) {
  const parts = filePath.split("/");
  const ufoIndex = parts.findIndex((part) => /\.ufo$/i.test(part));
  if (ufoIndex < 0 || ufoIndex + 2 >= parts.length) {
    return null;
  }
  return {
    ufoPath: parts.slice(0, ufoIndex + 1).join("/"),
    ufoName: parts[ufoIndex].replace(/\.ufo$/i, ""),
    layerDir: parts[ufoIndex + 1],
  };
}

// --- Fontra -------------------------------------------------------------------

// sourceNames: optional { sourceIdentifier: displayName } from font-data.json
export function parseFontraGlyph(text, { sourceNames = {} } = {}) {
  const data = JSON.parse(text);
  const layerNames = {};
  for (const source of data.sources ?? []) {
    if (!source.layerName) {
      continue;
    }
    const name =
      source.name ||
      (source.locationBase && sourceNames[source.locationBase]) ||
      source.locationBase ||
      source.layerName;
    layerNames[source.layerName] = name;
  }
  const layers = Object.entries(data.layers ?? {}).map(([layerName, layer]) => {
    const glyph = layer.glyph ?? {};
    return {
      id: layerName,
      name: layerNames[layerName] ?? layerName,
      advance: number(glyph.xAdvance, 0),
      contours: fontraContours(glyph.path),
      components: (glyph.components ?? []).map((component) => ({
        name: component.name ?? "",
        transform: fromDecomposed(component.transformation),
      })),
      anchors: (glyph.anchors ?? []).map((anchor) => ({
        name: anchor.name ?? "",
        x: number(anchor.x, 0),
        y: number(anchor.y, 0),
      })),
    };
  });
  return { name: data.name ?? "", unicodes: [], layers, sources: data.sources ?? [] };
}

const FONTRA_ON_CURVE = 0x00;
const FONTRA_OFF_CURVE_QUAD = 0x01;
const FONTRA_OFF_CURVE_CUBIC = 0x02;
const FONTRA_SMOOTH = 0x08;

function fontraContours(path) {
  if (!path) {
    return [];
  }
  if (Array.isArray(path.contours)) {
    return path.contours.map((contour) => ({
      closed: contour.isClosed !== false,
      points: (contour.points ?? []).map((point) => {
        const on = !point.type;
        const result = {
          x: number(point.x, 0),
          y: number(point.y, 0),
          on,
          smooth: !!point.smooth,
        };
        if (!on) {
          result.kind = point.type === "quad" ? "quad" : "cubic";
        }
        return result;
      }),
    }));
  }
  // Packed form: flat coordinates, point type flags and contour end points
  const contours = [];
  let start = 0;
  for (const info of path.contourInfo ?? []) {
    const points = [];
    for (let i = start; i <= info.endPoint; i++) {
      const type = path.pointTypes[i] ?? FONTRA_ON_CURVE;
      const offType = type & 0x07;
      const point = {
        x: number(path.coordinates[2 * i], 0),
        y: number(path.coordinates[2 * i + 1], 0),
        on: offType === FONTRA_ON_CURVE,
        smooth: !!(type & FONTRA_SMOOTH),
      };
      if (offType === FONTRA_OFF_CURVE_QUAD) {
        point.kind = "quad";
      } else if (offType === FONTRA_OFF_CURVE_CUBIC) {
        point.kind = "cubic";
      }
      points.push(point);
    }
    contours.push({ closed: !!info.isClosed, points });
    start = info.endPoint + 1;
  }
  return contours;
}

// --- Glyphs -------------------------------------------------------------------

// A whole .glyphs file: masters, glyphs by name, and the parsed plist (for
// kerning). Glyphs 2 and 3 are both handled.
export function parseGlyphsFile(text) {
  const font = parseOpenStepPlist(text);
  const masters = glyphsMasters(font);
  const masterNames = Object.fromEntries(masters.map((m) => [m.id, m.name]));
  const formatVersion = Number(font[".formatVersion"] ?? 2);
  const glyphs = new Map();
  for (const entry of font.glyphs ?? []) {
    const glyph = parseGlyphsGlyph(entry, { masterNames, formatVersion });
    glyphs.set(glyph.name, glyph);
  }
  return { font, masters, glyphs };
}

export function glyphsMasters(font) {
  return (font.fontMaster ?? []).map((master, index) => ({
    id: master.id ?? String(index),
    name:
      master.name ??
      ([master.weight, master.width, master.custom].filter(Boolean).join(" ") ||
        `Master ${index + 1}`),
  }));
}

// One glyph entry, as found in a .glyphs file's glyphs array or in a
// .glyphspackage .glyph file (packages only exist in Glyphs 3)
export function parseGlyphsGlyph(entry, { masterNames = {}, formatVersion = 3 } = {}) {
  const unicodes = glyphsUnicodes(entry.unicode, formatVersion >= 3);
  const layers = (entry.layers ?? []).map((layer) => {
    const id = layer.layerId ?? layer.name ?? "";
    const contours = [];
    const components = [];
    // Glyphs 3 keeps paths and components together in "shapes"
    for (const shape of layer.shapes ?? []) {
      if (shape.ref !== undefined) {
        components.push(glyphs3Component(shape));
      } else if (shape.nodes !== undefined) {
        contours.push(glyphsContour(shape));
      }
    }
    for (const path of layer.paths ?? []) {
      contours.push(glyphsContour(path));
    }
    for (const component of layer.components ?? []) {
      components.push(glyphs2Component(component));
    }
    const anchors = (layer.anchors ?? []).map((anchor) => {
      const [x, y] = glyphsPosition(anchor.pos ?? anchor.position);
      return { name: anchor.name ?? "", x, y };
    });
    return {
      id,
      name:
        layer.name ?? masterNames[id] ?? masterNames[layer.associatedMasterId] ?? id,
      advance: number(layer.width, 0),
      contours,
      components,
      anchors,
    };
  });
  return { name: entry.glyphname ?? "", unicodes, layers };
}

export function parseGlyphsGlyphFile(text, options) {
  return parseGlyphsGlyph(parseOpenStepPlist(text), options);
}

function glyphsUnicodes(value, decimal) {
  if (value === undefined) {
    return [];
  }
  // Glyphs 3: a decimal number or an array of them. Glyphs 2: comma separated hex.
  if (decimal) {
    const values = Array.isArray(value) ? value : [value];
    return values.map((v) => parseInt(v, 10)).filter(Number.isFinite);
  }
  return String(value)
    .split(",")
    .map((part) => parseInt(part.trim(), 16))
    .filter(Number.isFinite);
}

const GLYPHS2_NODE_TYPES = {
  LINE: "l",
  CURVE: "c",
  QCURVE: "q",
  OFFCURVE: "o",
};

function glyphsContour(path) {
  const closed = String(path.closed ?? "1") !== "0";
  const raw = (path.nodes ?? []).map((node) => {
    let x;
    let y;
    let type;
    let smooth = false;
    if (Array.isArray(node)) {
      // Glyphs 3: (x, y, type) with types l, c, q, o and an "s" suffix for smooth
      x = number(node[0], 0);
      y = number(node[1], 0);
      type = String(node[2] ?? "l");
      if (type.length === 2 && type.endsWith("s")) {
        smooth = true;
        type = type[0];
      }
    } else {
      // Glyphs 2: "x y TYPE [SMOOTH]"
      const parts = String(node).trim().split(/\s+/);
      x = number(parts[0], 0);
      y = number(parts[1], 0);
      type = GLYPHS2_NODE_TYPES[parts[2]] ?? "l";
      smooth = parts[3] === "SMOOTH";
    }
    return {
      x,
      y,
      on: type !== "o",
      segment: type === "c" ? "cubic" : type === "q" ? "quad" : null,
      smooth,
    };
  });
  return { closed, points: assignOffCurveKinds(raw, closed, "cubic") };
}

function glyphs3Component(shape) {
  const [x, y] = glyphsPosition(shape.pos);
  const [sx, sy] = shape.scale ? shape.scale.map((v) => number(v, 1)) : [1, 1];
  const angle = number(shape.angle, 0);
  const slant = shape.slant ? shape.slant.map((v) => number(v, 0)) : [0, 0];
  let t = IDENTITY;
  t = translate(t, x, y);
  t = rotate(t, (angle * Math.PI) / 180);
  t = scale(t, sx, sy);
  t = skew(t, (slant[0] * Math.PI) / 180, (slant[1] * Math.PI) / 180);
  return { name: shape.ref ?? "", transform: t };
}

function glyphs2Component(component) {
  let transform = [...IDENTITY];
  if (component.transform) {
    const values = String(component.transform)
      .replace(/[{}]/g, "")
      .split(",")
      .map((v) => number(v.trim(), 0));
    if (values.length === 6) {
      transform = values;
    }
  }
  return { name: component.name ?? "", transform };
}

function glyphsPosition(value) {
  if (Array.isArray(value)) {
    return [number(value[0], 0), number(value[1], 0)];
  }
  if (typeof value === "string") {
    const parts = value.replace(/[{}]/g, "").split(",");
    return [number(parts[0], 0), number(parts[1], 0)];
  }
  return [0, 0];
}

// --- shared -------------------------------------------------------------------

function number(value, fallback) {
  const result = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(result) ? result : fallback;
}

// Which reader handles a path, or null for files that are not glyphs
export function glyphFileKind(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".glif")) {
    return "glif";
  }
  if (/\.fontra\/glyphs\/[^/]+\.json$/.test(lower)) {
    return "fontra";
  }
  if (/\.glyphspackage\/glyphs\/[^/]+\.glyph$/.test(lower)) {
    return "glyphspackage";
  }
  if (lower.endsWith(".glyphs")) {
    return "glyphs";
  }
  return null;
}
