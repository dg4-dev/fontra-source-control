// Finds glyphs and kerning inside a font project at a given revision, starting
// from the path of a changed file. Used to draw components and kerning pairs.
//
// readText(rev, path) must resolve to the file's text, or null when the file
// does not exist at that revision.

import { fontraFileName, ufoStyleFileName } from "./filenames.js";
import {
  glyphsMasters,
  parseFontraGlyph,
  parseGlif,
  parseGlyphsFile,
  parseGlyphsGlyphFile,
} from "./glyph-model.js";
import { parseFontraKerning, parseGlyphsKerning, parseUFOKerning } from "./kerning.js";
import { flattenComponents } from "./outline.js";
import { parseOpenStepPlist, parseXMLPlist } from "./plist.js";

const FONT_PACKAGE = /^(.*?\.(ufo|fontra|glyphspackage))(\/|$)/i;

// Returns { format, fontPath } for a file inside a font, or null
export function locateFont(filePath) {
  if (/\.glyphs$/i.test(filePath)) {
    return { format: "glyphs", fontPath: filePath };
  }
  const match = filePath.match(FONT_PACKAGE);
  if (!match) {
    return null;
  }
  return { format: match[2].toLowerCase(), fontPath: match[1] };
}

export class FontFiles {
  constructor(readText, filePath) {
    this.readText = readText;
    this.filePath = filePath;
    const location = locateFont(filePath);
    this.format = location?.format ?? null;
    this.fontPath = location?.fontPath ?? null;
    this._cache = new Map();
  }

  _cached(key, compute) {
    if (!this._cache.has(key)) {
      const promise = compute().catch((error) => {
        console.warn(`[source-control] could not read ${key}`, error);
        return null;
      });
      this._cache.set(key, promise);
    }
    return this._cache.get(key);
  }

  _text(rev, path) {
    return this._cached(`text\0${rev}\0${path}`, () => this.readText(rev, path));
  }

  // { sourceIdentifier: name } for .fontra projects
  async fontraSourceNames(rev) {
    return this._cached(`fontraSources\0${rev}`, async () => {
      const text = await this._text(rev, `${this.fontPath}/font-data.json`);
      if (!text) {
        return {};
      }
      const sources = JSON.parse(text).sources ?? {};
      return Object.fromEntries(
        Object.entries(sources).map(([id, source]) => [id, source.name || id])
      );
    });
  }

  async glyphsMasterNames(rev) {
    return this._cached(`glyphsMasters\0${rev}`, async () => {
      let font;
      if (this.format === "glyphs") {
        font = (await this._glyphsFile(rev))?.font;
      } else {
        const text = await this._text(rev, `${this.fontPath}/fontinfo.plist`);
        font = text ? parseOpenStepPlist(text) : null;
      }
      return Object.fromEntries(
        glyphsMasters(font ?? {}).map((master) => [master.id, master.name])
      );
    });
  }

  _glyphsFile(rev) {
    return this._cached(`glyphsFile\0${rev}`, async () => {
      const text = await this._text(rev, this.fontPath);
      return text ? parseGlyphsFile(text) : null;
    });
  }

  // Parses the changed file itself into glyphs: a Map of name → Glyph.
  // filePath differs from this.filePath for the old side of a rename.
  async glyphsInFile(rev, filePath = this.filePath) {
    const text = await this._text(rev, filePath);
    if (text === null) {
      return new Map();
    }
    const glyphs = new Map();
    const lower = filePath.toLowerCase();
    if (lower.endsWith(".glif")) {
      const ufoName =
        this.fontPath
          ?.split("/")
          .pop()
          .replace(/\.ufo$/i, "") ?? "";
      const layerDir = filePath.split("/").at(-2);
      const layerName = layerDir === "glyphs" ? ufoName : `${ufoName} · ${layerDir}`;
      const glyph = parseGlif(text, { layerId: layerDir, layerName });
      glyphs.set(glyph.name, glyph);
    } else if (this.format === "fontra" && lower.endsWith(".json")) {
      const glyph = parseFontraGlyph(text, {
        sourceNames: await this.fontraSourceNames(rev),
      });
      glyphs.set(glyph.name, glyph);
    } else if (this.format === "glyphspackage" && lower.endsWith(".glyph")) {
      const glyph = parseGlyphsGlyphFile(text, {
        masterNames: await this.glyphsMasterNames(rev),
      });
      glyphs.set(glyph.name, glyph);
    } else if (this.format === "glyphs") {
      return (await this._glyphsFile(rev))?.glyphs ?? new Map();
    }
    return glyphs;
  }

  // Any glyph of the font by name, or null
  async glyph(rev, name, { layerDir = "glyphs" } = {}) {
    return this._cached(`glyph\0${rev}\0${layerDir}\0${name}`, async () => {
      switch (this.format) {
        case "ufo": {
          const contents = await this._ufoContents(rev, layerDir);
          const fileName = contents?.[name];
          if (!fileName) {
            return null;
          }
          const text = await this._text(
            rev,
            `${this.fontPath}/${layerDir}/${fileName}`
          );
          return text ? parseGlif(text, { layerId: layerDir }) : null;
        }
        case "fontra": {
          const text = await this._text(
            rev,
            `${this.fontPath}/glyphs/${fontraFileName(name)}.json`
          );
          return text
            ? parseFontraGlyph(text, { sourceNames: await this.fontraSourceNames(rev) })
            : null;
        }
        case "glyphspackage": {
          const text = await this._text(
            rev,
            `${this.fontPath}/glyphs/${ufoStyleFileName(name)}.glyph`
          );
          return text
            ? parseGlyphsGlyphFile(text, {
                masterNames: await this.glyphsMasterNames(rev),
              })
            : null;
        }
        case "glyphs":
          return (await this._glyphsFile(rev))?.glyphs.get(name) ?? null;
      }
      return null;
    });
  }

  _ufoContents(rev, layerDir) {
    return this._cached(`ufoContents\0${rev}\0${layerDir}`, async () => {
      const text = await this._text(rev, `${this.fontPath}/${layerDir}/contents.plist`);
      return text ? parseXMLPlist(text) : null;
    });
  }

  // The layer of a glyph that matches a layer id or a font source id
  async glyphLayer(rev, name, { layerId = null, sourceId = null, layerDir } = {}) {
    const glyph = await this.glyph(rev, name, { layerDir });
    return glyph ? pickLayer(glyph, { layerId, sourceId }) : null;
  }

  // Resolves a layer's components into contours. Returns { contours, missing }.
  async componentContours(rev, glyph, layer) {
    const layerDir = this.format === "ufo" ? layer.id : undefined;
    const sourceId = sourceIdForLayer(glyph, layer.id);
    const loaded = new Map();
    const load = async (currentLayer, depth) => {
      if (depth > 8) {
        return;
      }
      for (const component of currentLayer.components) {
        if (loaded.has(component.name)) {
          continue;
        }
        const base = await this.glyphLayer(rev, component.name, {
          layerId: layer.id,
          sourceId,
          layerDir,
        });
        loaded.set(component.name, base);
        if (base) {
          await load(base, depth + 1);
        }
      }
    };
    await load(layer, 0);
    return flattenComponents(layer, (name) => loaded.get(name) ?? null);
  }

  // Kerning of the font at a revision (null when the format has none)
  async kerning(rev) {
    return this._cached(`kerning\0${rev}`, async () => {
      switch (this.format) {
        case "ufo": {
          const [kerningText, groupsText] = await Promise.all([
            this._text(rev, `${this.fontPath}/kerning.plist`),
            this._text(rev, `${this.fontPath}/groups.plist`),
          ]);
          if (kerningText === null && groupsText === null) {
            return null;
          }
          return parseUFOKerning(kerningText, groupsText, {
            sourceName: this.fontPath
              .split("/")
              .pop()
              .replace(/\.ufo$/i, ""),
          });
        }
        case "fontra": {
          const text = await this._text(rev, `${this.fontPath}/kerning.csv`);
          if (text === null) {
            return null;
          }
          const tables = parseFontraKerning(text, {
            sourceNames: await this.fontraSourceNames(rev),
          });
          return tables.kern ?? Object.values(tables)[0] ?? null;
        }
        case "glyphs": {
          const file = await this._glyphsFile(rev);
          return file ? parseGlyphsKerning(file.font) : null;
        }
        case "glyphspackage": {
          const text = await this._text(rev, `${this.fontPath}/fontinfo.plist`);
          return text
            ? parseGlyphsKerning(parseOpenStepPlist(text), { glyphEntries: [] })
            : null;
        }
      }
      return null;
    });
  }

  // The layer to draw for a kerning source (master)
  async kerningGlyphLayer(rev, name, sourceId) {
    return this.glyphLayer(rev, name, { layerId: sourceId, sourceId });
  }
}

// Fontra glyph layers are tied to font sources through the glyph's sources
function sourceIdForLayer(glyph, layerId) {
  const source = glyph.sources?.find((s) => s.layerName === layerId);
  return source?.locationBase ?? null;
}

export function pickLayer(glyph, { layerId = null, sourceId = null } = {}) {
  const layers = glyph.layers;
  if (!layers.length) {
    return null;
  }
  if (layerId !== null) {
    const byId = layers.find((layer) => layer.id === layerId);
    if (byId) {
      return byId;
    }
  }
  if (sourceId !== null) {
    const source = glyph.sources?.find((s) => s.locationBase === sourceId);
    const bySource = source && layers.find((layer) => layer.id === source.layerName);
    if (bySource) {
      return bySource;
    }
    const byLayerName = layers.find((layer) => layer.id === sourceId);
    if (byLayerName) {
      return byLayerName;
    }
  }
  return layers[0];
}
