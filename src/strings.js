// UI strings. Follow Fontra's display language the same way Fontra does:
// it keeps the language code in localStorage ("fontra-language-language"),
// uses the table for exactly that code, and falls back to English. Terms such
// as "component", "anchor" and "advance width" follow Fontra's own
// translations (src-js/fontra-core/assets/lang/*.js in the Fontra repo), and
// git terms follow VS Code's translations.
//
// Fontra's languages without a table here (currently Tagalog) show English.
//
// Placeholders are written {name} and filled from t(key, { name: value }).

import de from "./lang/de.js";
import en from "./lang/en.js";
import es419 from "./lang/es-419.js";
import esES from "./lang/es-ES.js";
import fr from "./lang/fr.js";
import it from "./lang/it.js";
import ja from "./lang/ja.js";
import nl from "./lang/nl.js";
import ptBR from "./lang/pt-BR.js";
import ptPT from "./lang/pt-PT.js";
import ru from "./lang/ru.js";
import zhCN from "./lang/zh-CN.js";
import zhTW from "./lang/zh-TW.js";

const LANGUAGE_STORAGE_KEY = "fontra-language-language";
const DEFAULT_LANGUAGE = "en";

// One table per language code, as Fontra names them
export const strings = {
  "en": en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  "ja": ja,
  "de": de,
  "nl": nl,
  "fr": fr,
  "it": it,
  "es-ES": esES,
  "es-419": es419,
  "pt-BR": ptBR,
  "pt-PT": ptPT,
  "ru": ru,
};

// Set by hosts other than Fontra (the VS Code extension), which know the
// display language without Fontra's setting
let languageOverride = null;

export function setLanguage(code) {
  languageOverride = code ? resolveLanguage(code) : null;
}

// The table that best matches a language code from elsewhere, such as VS
// Code's "zh-cn", "pt-br" or "es": the same code in any case, then a table for
// the same base language.
export function resolveLanguage(code) {
  if (typeof code !== "string" || !code) {
    return DEFAULT_LANGUAGE;
  }
  const lower = code.toLowerCase().replace("_", "-");
  const names = Object.keys(strings);
  const exact = names.find((name) => name.toLowerCase() === lower);
  if (exact) {
    return exact;
  }
  const aliases = {
    "zh-hans": "zh-CN",
    "zh-sg": "zh-CN",
    "zh-hant": "zh-TW",
    "zh-hk": "zh-TW",
  };
  if (aliases[lower]) {
    return aliases[lower];
  }
  const base = lower.split("-")[0];
  return (
    names.find((name) => name.toLowerCase() === base) ??
    names.find((name) => name.toLowerCase().startsWith(`${base}-`)) ??
    DEFAULT_LANGUAGE
  );
}

export function currentLanguage(storage = safeLocalStorage()) {
  if (languageOverride) {
    return languageOverride;
  }
  try {
    // Fontra stores string settings as raw (non-JSON) strings
    return storage?.getItem(LANGUAGE_STORAGE_KEY) || DEFAULT_LANGUAGE;
  } catch (e) {
    // localStorage unavailable
    return DEFAULT_LANGUAGE;
  }
}

export function translate(key, language, values = {}) {
  const table = strings[language] || strings[DEFAULT_LANGUAGE];
  const text = table[key] ?? strings[DEFAULT_LANGUAGE][key] ?? key;
  return text.replace(/\{(\w+)\}/g, (whole, name) =>
    name in values ? String(values[name]) : whole
  );
}

// Fontra reloads the page when its display language changes, so reading the
// setting on each call is enough to stay in sync.
export function t(key, values) {
  return translate(key, currentLanguage(), values);
}

function safeLocalStorage() {
  try {
    return globalThis.localStorage;
  } catch (e) {
    return undefined;
  }
}
