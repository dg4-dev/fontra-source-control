// Property list readers: the XML flavor (UFO's contents.plist, kerning.plist,
// groups.plist) and the OpenStep flavor that .glyphs files use.

import { parseXML } from "./xml.js";

export class PlistParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlistParseError";
  }
}

export function parseXMLPlist(source) {
  const root = parseXML(source);
  const valueElement = root.name === "plist" ? root.children[0] : root;
  return valueElement ? xmlPlistValue(valueElement) : null;
}

function xmlPlistValue(element) {
  switch (element.name) {
    case "dict": {
      const result = {};
      const children = element.children;
      for (let i = 0; i < children.length; i += 2) {
        if (children[i].name !== "key" || !children[i + 1]) {
          throw new PlistParseError("dict keys and values do not pair up");
        }
        result[children[i].text] = xmlPlistValue(children[i + 1]);
      }
      return result;
    }
    case "array":
      return element.children.map(xmlPlistValue);
    case "string":
      return element.text;
    case "integer":
    case "real":
      return Number(element.text.trim());
    case "true":
      return true;
    case "false":
      return false;
    case "date":
    case "data":
      return element.text.trim();
    default:
      throw new PlistParseError(`unknown plist element <${element.name}>`);
  }
}

// OpenStep plist: dictionaries { key = value; }, arrays ( a, b ), quoted or
// bare strings, and <hex data>. Bare strings are returned as strings; callers
// convert numbers where they expect them.
export function parseOpenStepPlist(source) {
  const parser = new OpenStepParser(source);
  parser.skipWhitespace();
  const value = parser.parseValue();
  parser.skipWhitespace();
  if (parser.index < source.length) {
    throw new PlistParseError(`unexpected text at offset ${parser.index}`);
  }
  return value;
}

const BARE_CHARACTER = /[A-Za-z0-9_.$/:\-+|]/;

class OpenStepParser {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  error(message) {
    return new PlistParseError(`${message} at offset ${this.index}`);
  }

  skipWhitespace() {
    const source = this.source;
    while (this.index < source.length) {
      const c = source[this.index];
      if (c === " " || c === "\n" || c === "\t" || c === "\r") {
        this.index++;
      } else if (c === "/" && source[this.index + 1] === "/") {
        const end = source.indexOf("\n", this.index);
        this.index = end < 0 ? source.length : end + 1;
      } else if (c === "/" && source[this.index + 1] === "*") {
        const end = source.indexOf("*/", this.index + 2);
        this.index = end < 0 ? source.length : end + 2;
      } else {
        break;
      }
    }
  }

  parseValue() {
    const c = this.source[this.index];
    if (c === "{") {
      return this.parseDict();
    }
    if (c === "(") {
      return this.parseArray();
    }
    if (c === '"' || c === "'") {
      return this.parseQuoted(c);
    }
    if (c === "<") {
      return this.parseData();
    }
    return this.parseBare();
  }

  parseDict() {
    this.index++; // {
    const result = {};
    for (;;) {
      this.skipWhitespace();
      if (this.source[this.index] === "}") {
        this.index++;
        return result;
      }
      if (this.index >= this.source.length) {
        throw this.error("unterminated dictionary");
      }
      const key = this.parseValue();
      this.skipWhitespace();
      if (this.source[this.index] !== "=") {
        throw this.error("expected =");
      }
      this.index++;
      this.skipWhitespace();
      result[key] = this.parseValue();
      this.skipWhitespace();
      if (this.source[this.index] === ";") {
        this.index++;
      } else if (this.source[this.index] !== "}") {
        throw this.error("expected ;");
      }
    }
  }

  parseArray() {
    this.index++; // (
    const result = [];
    for (;;) {
      this.skipWhitespace();
      if (this.source[this.index] === ")") {
        this.index++;
        return result;
      }
      if (this.index >= this.source.length) {
        throw this.error("unterminated array");
      }
      result.push(this.parseValue());
      this.skipWhitespace();
      if (this.source[this.index] === ",") {
        this.index++;
      } else if (this.source[this.index] !== ")") {
        throw this.error("expected , or )");
      }
    }
  }

  parseQuoted(quote) {
    const source = this.source;
    let i = this.index + 1;
    let result = "";
    while (i < source.length) {
      const c = source[i];
      if (c === quote) {
        this.index = i + 1;
        return result;
      }
      if (c === "\\") {
        const next = source[i + 1];
        if (next === "n") {
          result += "\n";
          i += 2;
        } else if (next === "t") {
          result += "\t";
          i += 2;
        } else if (next === "r") {
          result += "\r";
          i += 2;
        } else if (next === "U" || next === "u") {
          const hex = source.slice(i + 2, i + 6);
          result += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else if (next >= "0" && next <= "7") {
          const octal = source.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)[0];
          result += String.fromCharCode(parseInt(octal, 8));
          i += 1 + octal.length;
        } else {
          result += next ?? "";
          i += 2;
        }
      } else {
        result += c;
        i++;
      }
    }
    throw this.error("unterminated string");
  }

  parseData() {
    const end = this.source.indexOf(">", this.index);
    if (end < 0) {
      throw this.error("unterminated data");
    }
    const data = this.source.slice(this.index + 1, end).replace(/\s+/g, "");
    this.index = end + 1;
    return data;
  }

  parseBare() {
    const start = this.index;
    while (
      this.index < this.source.length &&
      BARE_CHARACTER.test(this.source[this.index])
    ) {
      this.index++;
    }
    if (this.index === start) {
      throw this.error(`unexpected character ${JSON.stringify(this.source[start])}`);
    }
    return this.source.slice(start, this.index);
  }
}
