// Reads pair kerning from UFO (kerning.plist + groups.plist), Fontra
// (kerning.csv) and Glyphs (.glyphs, .glyphspackage fontinfo.plist) into one
// model, and compares two versions of it.
//
//   Kerning {
//     sources: { id, name }[]
//     groups1: { groupName: glyphNames[] }   left side of a pair
//     groups2: { groupName: glyphNames[] }   right side of a pair
//     pairs:   Map("left\u0000right" → { left, right, values: { sourceId: number } })
//   }
//
// A pair side is a glyph name, or "@" followed by a group name.

import { glyphsMasters } from "./glyph-model.js";
import { parseOpenStepPlist, parseXMLPlist } from "./plist.js";

const PAIR_SEPARATOR = "\u0000";

export function pairKey(left, right) {
  return left + PAIR_SEPARATOR + right;
}

function emptyKerning(sources) {
  return { sources, groups1: {}, groups2: {}, pairs: new Map() };
}

function setValue(kerning, left, right, sourceId, value) {
  const key = pairKey(left, right);
  let pair = kerning.pairs.get(key);
  if (!pair) {
    pair = { left, right, values: {} };
    kerning.pairs.set(key, pair);
  }
  pair.values[sourceId] = value;
}

// --- UFO ----------------------------------------------------------------------

const UFO_KERN1 = "public.kern1.";
const UFO_KERN2 = "public.kern2.";

// kerningText / groupsText may be null when the file does not exist
export function parseUFOKerning(kerningText, groupsText, { sourceName = "" } = {}) {
  const sourceId = "default";
  const kerning = emptyKerning([{ id: sourceId, name: sourceName || "UFO" }]);
  const groups = groupsText ? (parseXMLPlist(groupsText) ?? {}) : {};
  for (const [name, members] of Object.entries(groups)) {
    if (name.startsWith(UFO_KERN1)) {
      kerning.groups1[name.slice(UFO_KERN1.length)] = members;
    } else if (name.startsWith(UFO_KERN2)) {
      kerning.groups2[name.slice(UFO_KERN2.length)] = members;
    }
  }
  const table = kerningText ? (parseXMLPlist(kerningText) ?? {}) : {};
  for (const [left, rights] of Object.entries(table)) {
    for (const [right, value] of Object.entries(rights)) {
      setValue(
        kerning,
        ufoSide(left, UFO_KERN1),
        ufoSide(right, UFO_KERN2),
        sourceId,
        value
      );
    }
  }
  return kerning;
}

function ufoSide(name, prefix) {
  return name.startsWith(prefix) ? "@" + name.slice(prefix.length) : name;
}

// --- Fontra -------------------------------------------------------------------

// Returns { kernType: Kerning }, usually just "kern". sourceNames maps source
// identifiers to display names (from font-data.json).
export function parseFontraKerning(text, { sourceNames = {} } = {}) {
  const rows = parseCSV(text, ";");
  const tables = {};
  let i = 0;
  const nextNonBlank = () => {
    while (i < rows.length && isBlankRow(rows[i])) {
      i++;
    }
    return i < rows.length ? rows[i++] : null;
  };
  for (;;) {
    const typeRow = nextNonBlank();
    if (!typeRow) {
      break;
    }
    if (typeRow[0] !== "TYPE") {
      throw new Error(`kerning.csv: expected TYPE at row ${i}`);
    }
    const kernType = rows[i++]?.[0] ?? "kern";
    const groups = {};
    let header = nextNonBlank();
    while (
      header &&
      (header[0] === "GROUPS1" || header[0] === "GROUPS2" || header[0] === "GROUPS")
    ) {
      const side = header[0] === "GROUPS2" ? "groups2" : "groups1";
      const isLegacy = header[0] === "GROUPS";
      groups[side] = {};
      while (i < rows.length && !isBlankRow(rows[i])) {
        const [name, ...members] = rows[i++];
        groups[side][name] = members;
      }
      if (isLegacy) {
        groups.groups2 = { ...groups.groups1 };
      }
      header = nextNonBlank();
    }
    if (!header || header[0] !== "VALUES") {
      throw new Error(`kerning.csv: expected VALUES at row ${i}`);
    }
    const sourceRow = rows[i++] ?? [];
    const sourceIds = sourceRow.slice(2);
    const kerning = emptyKerning(
      sourceIds.map((id) => ({ id, name: sourceNames[id] ?? id }))
    );
    kerning.groups1 = groups.groups1 ?? {};
    kerning.groups2 = groups.groups2 ?? {};
    while (i < rows.length && !isBlankRow(rows[i])) {
      const [left, right, ...values] = rows[i++];
      values.forEach((value, index) => {
        if (value !== "" && value !== undefined && index < sourceIds.length) {
          setValue(kerning, left, right, sourceIds[index], Number(value));
        }
      });
    }
    tables[kernType] = kerning;
  }
  return tables;
}

function isBlankRow(row) {
  return !row.length || (row.length === 1 && row[0] === "");
}

// CSV as written by Python's csv module: quoted fields may contain the
// delimiter, quotes ("" escapes) and newlines.
export function parseCSV(text, delimiter = ",") {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        field += c;
      }
      i++;
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      row.push(field);
      rows.push(row.length === 1 && row[0] === "" ? [] : row);
      row = [];
      field = "";
      if (c === "\r" && text[i + 1] === "\n") {
        i++;
      }
    } else {
      field += c;
    }
    i++;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// --- Glyphs -------------------------------------------------------------------

// font: a parsed .glyphs file, or a .glyphspackage fontinfo.plist (whose glyph
// list lives elsewhere; pass those glyph entries as glyphEntries)
export function parseGlyphsKerning(font, { glyphEntries = null } = {}) {
  const masters = glyphsMasters(font);
  const kerning = emptyKerning(masters.map(({ id, name }) => ({ id, name })));
  const table = font.kerningLTR ?? font.kerning ?? {};
  for (const [masterId, lefts] of Object.entries(table)) {
    for (const [left, rights] of Object.entries(lefts)) {
      for (const [right, value] of Object.entries(rights)) {
        setValue(
          kerning,
          glyphsSide(left, "@MMK_L_"),
          glyphsSide(right, "@MMK_R_"),
          masterId,
          Number(value)
        );
      }
    }
  }
  for (const glyph of glyphEntries ?? font.glyphs ?? []) {
    const name = glyph.glyphname;
    // A glyph's right kerning group is used when it is on the left of a pair
    const leftGroup = glyph.kernRight ?? glyph.rightKerningGroup;
    const rightGroup = glyph.kernLeft ?? glyph.leftKerningGroup;
    if (leftGroup) {
      (kerning.groups1[leftGroup] ??= []).push(name);
    }
    if (rightGroup) {
      (kerning.groups2[rightGroup] ??= []).push(name);
    }
  }
  return kerning;
}

function glyphsSide(key, prefix) {
  return key.startsWith(prefix) ? "@" + key.slice(prefix.length) : key;
}

export function parseGlyphsFileKerning(text) {
  return parseGlyphsKerning(parseOpenStepPlist(text));
}

// --- comparing ----------------------------------------------------------------

// Returns { sources, pairs, groups }:
//   pairs:  { left, right, sourceId, old, new }[] (old/new null when absent)
//   groups: { side: 1 | 2, name, added: string[], removed: string[], status }[]
export function diffKerning(oldKerning, newKerning) {
  oldKerning ??= emptyKerning([]);
  newKerning ??= emptyKerning([]);
  const sources = mergeSources(oldKerning.sources, newKerning.sources);
  const pairs = [];
  const keys = new Set([...oldKerning.pairs.keys(), ...newKerning.pairs.keys()]);
  for (const key of keys) {
    const oldPair = oldKerning.pairs.get(key);
    const newPair = newKerning.pairs.get(key);
    const pair = newPair ?? oldPair;
    for (const source of sources) {
      const oldValue = oldPair?.values[source.id] ?? null;
      const newValue = newPair?.values[source.id] ?? null;
      if (oldValue !== newValue) {
        pairs.push({
          left: pair.left,
          right: pair.right,
          sourceId: source.id,
          old: oldValue,
          new: newValue,
        });
      }
    }
  }
  pairs.sort(
    (a, b) =>
      a.left.localeCompare(b.left) ||
      a.right.localeCompare(b.right) ||
      sources.findIndex((s) => s.id === a.sourceId) -
        sources.findIndex((s) => s.id === b.sourceId)
  );
  const groups = [
    ...diffGroups(oldKerning.groups1, newKerning.groups1, 1),
    ...diffGroups(oldKerning.groups2, newKerning.groups2, 2),
  ];
  return { sources, pairs, groups };
}

function mergeSources(oldSources, newSources) {
  const result = [...newSources];
  for (const source of oldSources) {
    if (!result.some((s) => s.id === source.id)) {
      result.push(source);
    }
  }
  return result;
}

function diffGroups(oldGroups, newGroups, side) {
  const result = [];
  const names = [
    ...new Set([...Object.keys(oldGroups), ...Object.keys(newGroups)]),
  ].sort();
  for (const name of names) {
    const oldMembers = oldGroups[name] ?? null;
    const newMembers = newGroups[name] ?? null;
    const oldSet = new Set(oldMembers ?? []);
    const newSet = new Set(newMembers ?? []);
    const added = [...newSet].filter((glyph) => !oldSet.has(glyph));
    const removed = [...oldSet].filter((glyph) => !newSet.has(glyph));
    if (!oldMembers || !newMembers || added.length || removed.length) {
      result.push({
        side,
        name,
        added,
        removed,
        status: !oldMembers ? "added" : !newMembers ? "removed" : "modified",
      });
    }
  }
  return result;
}

// The glyph drawn for a pair side: the glyph itself, or a group's first
// member. Groups are often named after their key glyph, so an unknown or empty
// group falls back to its own name.
export function representativeGlyph(kerning, side, which) {
  if (!side.startsWith("@")) {
    return side;
  }
  const groups = which === 1 ? kerning.groups1 : kerning.groups2;
  return groups[side.slice(1)]?.[0] ?? side.slice(1);
}

export function groupMembers(kerning, side, which) {
  if (!side.startsWith("@")) {
    return null;
  }
  const groups = which === 1 ? kerning.groups1 : kerning.groups2;
  return groups[side.slice(1)] ?? [];
}

// Which reader handles a path, or null for files without kerning
export function kerningFileKind(filePath) {
  const lower = filePath.toLowerCase();
  if (/\.ufo\/(kerning|groups)\.plist$/.test(lower)) {
    return "ufo";
  }
  if (/\.fontra\/kerning\.csv$/.test(lower)) {
    return "fontra";
  }
  if (/\.glyphspackage\/fontinfo\.plist$/.test(lower)) {
    return "glyphspackage";
  }
  if (lower.endsWith(".glyphs")) {
    return "glyphs";
  }
  return null;
}
