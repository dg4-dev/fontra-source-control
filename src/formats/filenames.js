// Glyph name → file name rules, needed to find a component's base glyph or a
// kerning pair's glyphs next to the changed file.

// Port of Fontra's stringToFileName (fontra/backends/filenames.py), used for
// .fontra glyph files: glyphs/<fileName>.json
const SEPARATOR = "^";
const RESERVED_CHARACTERS = new Set([
  ...'" % * + / : < > ? [ \\ ] |'.split(" "),
  String.fromCharCode(0x7f),
  SEPARATOR,
]);
for (let code = 0; code < 32; code++) {
  RESERVED_CHARACTERS.add(String.fromCharCode(code));
}
const RESERVED_FILE_NAMES = new Set(
  "con prn aux clock$ nul com1 lpt1 lpt2 lpt3 com2 com3 com4".split(" ")
);
const BASE32 = "0123456789ABCDEFGHIJKLMNOPQRSTUV";

function isUpper(c) {
  return c !== c.toLowerCase() && c === c.toUpperCase();
}

export function fontraFileName(name) {
  const characters = Array.from(name);
  const codeDigits = [];
  for (let i = 0; i < characters.length; i += 5) {
    let digit = 0;
    let bit = 1;
    for (const c of characters.slice(i, i + 5)) {
      if (isUpper(c)) {
        digit |= bit;
      }
      bit <<= 1;
    }
    codeDigits.push(digit);
  }
  while (codeDigits.length && codeDigits.at(-1) === 0) {
    codeDigits.pop();
  }
  let fileName = characters
    .map((c) =>
      RESERVED_CHARACTERS.has(c)
        ? "%" + c.codePointAt(0).toString(16).toUpperCase().padStart(2, "0")
        : c
    )
    .join("");
  if (fileName[0] === ".") {
    fileName = "%2E" + fileName.slice(1);
  } else if (fileName.includes(".")) {
    const dot = fileName.indexOf(".");
    const base = fileName.slice(0, dot);
    if (RESERVED_FILE_NAMES.has(base.toLowerCase())) {
      fileName = base + "%2E" + fileName.slice(dot + 1);
    }
  }
  if (!codeDigits.length && RESERVED_FILE_NAMES.has(fileName.toLowerCase())) {
    codeDigits.push(0);
  }
  const code = codeDigits.length
    ? SEPARATOR + codeDigits.map((d) => BASE32[d]).join("")
    : "";
  return fileName + code;
}

// The UFO 3 user name to file name convention (without the clash handling,
// which needs the list of existing files): uppercase letters get a trailing
// underscore. Used as a best guess for .glyphspackage glyph files.
const UFO_ILLEGAL = new Set('"*+/:<>?[\\]|'.split(""));

export function ufoStyleFileName(name) {
  let result = Array.from(name)
    .map((c) => {
      if (UFO_ILLEGAL.has(c) || c.codePointAt(0) < 32 || c.codePointAt(0) === 0x7f) {
        return "_";
      }
      return isUpper(c) ? c + "_" : c;
    })
    .join("");
  if (result.startsWith(".")) {
    result = "_" + result.slice(1);
  }
  const parts = result.split(".");
  return parts
    .map((part) => (RESERVED_FILE_NAMES.has(part.toLowerCase()) ? "_" + part : part))
    .join(".");
}
