// Small observable settings store, persisted to localStorage.

const STORAGE_KEY = "fontra-plugin-source-control.settings";

export const DEFAULT_BRIDGE_URL = "http://localhost:8765";

export const DEFAULT_SETTINGS = Object.freeze({
  bridgeUrl: DEFAULT_BRIDGE_URL,
  pullMode: "merge", // "merge" | "rebase" | "ff-only"
  autoRefresh: true, // poll the repository status while the panel is open
  glyphDiffMode: "overlay", // "overlay" | "sideBySide"
  showPoints: true,
  mergeNoFastForward: false,
});

const CHOICES = {
  pullMode: ["merge", "rebase", "ff-only"],
  glyphDiffMode: ["overlay", "sideBySide"],
};

export class SourceControlSettings {
  constructor(storage = safeLocalStorage()) {
    this._storage = storage;
    this._listeners = new Set();
    this._values = { ...DEFAULT_SETTINGS, ...this._load() };
  }

  get(key) {
    return this._values[key];
  }

  get values() {
    return { ...this._values };
  }

  set(key, value) {
    if (!(key in DEFAULT_SETTINGS)) {
      throw new Error(`unknown setting: ${key}`);
    }
    value = sanitize(key, value);
    if (this._values[key] === value) {
      return;
    }
    this._values[key] = value;
    this._save();
    for (const listener of this._listeners) {
      listener(key, value);
    }
  }

  addListener(listener) {
    this._listeners.add(listener);
  }

  removeListener(listener) {
    this._listeners.delete(listener);
  }

  _load() {
    try {
      const stored = JSON.parse(this._storage?.getItem(STORAGE_KEY) || "{}");
      const result = {};
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (key in stored) {
          result[key] = sanitize(key, stored[key]);
        }
      }
      return result;
    } catch (e) {
      return {};
    }
  }

  _save() {
    try {
      this._storage?.setItem(STORAGE_KEY, JSON.stringify(this._values));
    } catch (e) {
      // Storage may be unavailable (private mode, quota); settings stay in memory.
    }
  }
}

function sanitize(key, value) {
  const defaultValue = DEFAULT_SETTINGS[key];
  if (typeof defaultValue === "boolean") {
    return !!value;
  }
  if (key === "bridgeUrl") {
    return normalizeBridgeUrl(value) ?? defaultValue;
  }
  if (CHOICES[key]) {
    return CHOICES[key].includes(value) ? value : defaultValue;
  }
  return value ?? defaultValue;
}

// Accepts "8765", "localhost:8765" or a full URL; returns an origin without a
// trailing slash, or null when the value is not usable.
export function normalizeBridgeUrl(value) {
  if (typeof value !== "string") {
    return null;
  }
  let text = value.trim();
  if (!text) {
    return null;
  }
  if (/^\d+$/.test(text)) {
    text = `http://localhost:${text}`;
  } else if (!/^https?:\/\//i.test(text)) {
    text = `http://${text}`;
  }
  try {
    const url = new URL(text);
    return `${url.protocol}//${url.host}`;
  } catch (e) {
    return null;
  }
}

function safeLocalStorage() {
  try {
    return globalThis.localStorage;
  } catch (e) {
    return undefined;
  }
}
