import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SETTINGS,
  SourceControlSettings,
  normalizeBridgeUrl,
} from "../src/settings.js";
import { currentLanguage, strings, translate } from "../src/strings.js";
import { countChanges, parseUnifiedDiff } from "../src/unified-diff.js";

class MemoryStorage {
  constructor(initial = {}) {
    this.data = { ...initial };
  }
  getItem(key) {
    return key in this.data ? this.data[key] : null;
  }
  setItem(key, value) {
    this.data[key] = String(value);
  }
}

test("unified diff parsing", () => {
  const parsed = parseUnifiedDiff(`diff --git a/old b/new
index 1..2 100644
--- a/old
+++ b/new
@@ -1,3 +1,3 @@ <glyph>
 a
-b
+c
 d
@@ -10 +10,2 @@
-x
+y
+z
\\ No newline at end of file
`);
  assert.equal(parsed.binary, false);
  assert.equal(parsed.hunks.length, 2);
  assert.equal(parsed.hunks[0].section, "<glyph>");
  assert.deepEqual(
    parsed.hunks[0].lines.map((l) => [l.type, l.text, l.oldLine, l.newLine]),
    [
      ["context", "a", 1, 1],
      ["remove", "b", 2, null],
      ["add", "c", null, 2],
      ["context", "d", 3, 3],
    ]
  );
  assert.equal(parsed.hunks[1].lines.at(-1).noNewline, true);
  assert.deepEqual(countChanges(parsed), { added: 3, removed: 2 });
  assert.equal(parseUnifiedDiff("Binary files old and new differ\n").binary, true);
});

test("settings persist and are sanitized", () => {
  const storage = new MemoryStorage();
  const settings = new SourceControlSettings(storage);
  assert.deepEqual(settings.values, DEFAULT_SETTINGS);
  const events = [];
  settings.addListener((key, value) => events.push([key, value]));
  settings.set("bridgeUrl", "9000");
  settings.set("pullMode", "bogus");
  settings.set("glyphDiffMode", "sideBySide");
  assert.deepEqual(events, [
    ["bridgeUrl", "http://localhost:9000"],
    ["glyphDiffMode", "sideBySide"],
  ]);
  const reloaded = new SourceControlSettings(storage);
  assert.equal(reloaded.get("bridgeUrl"), "http://localhost:9000");
  assert.equal(reloaded.get("pullMode"), "merge");
  assert.throws(() => settings.set("nope", 1));
});

test("bridge URLs", () => {
  assert.equal(normalizeBridgeUrl("localhost:8765"), "http://localhost:8765");
  assert.equal(
    normalizeBridgeUrl("http://127.0.0.1:1234/path/"),
    "http://127.0.0.1:1234"
  );
  assert.equal(normalizeBridgeUrl(""), null);
  assert.equal(normalizeBridgeUrl("http://"), null);
});

test("every language has the English keys and the same placeholders", () => {
  const english = strings.en;
  for (const [language, table] of Object.entries(strings)) {
    for (const key of Object.keys(table)) {
      assert.ok(key in english, `${language}: unknown key ${key}`);
    }
    if (language === "en") {
      continue;
    }
    for (const [key, text] of Object.entries(english)) {
      assert.ok(key in table, `${language}: missing ${key}`);
      const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      assert.deepEqual(
        placeholders(table[key]),
        placeholders(text),
        `${language}: ${key}`
      );
    }
  }
});

test("translation lookup and placeholders", () => {
  assert.equal(
    translate("panel.commitTo", "ja", { branch: "main" }),
    "main にコミット"
  );
  assert.equal(translate("panel.commitTo", "tl", { branch: "main" }), "Commit to main");
  assert.equal(
    translate("dialog.stashDrop.message", "en", { index: 2 }).startsWith(
      "Delete stash@{2}"
    ),
    true
  );
  assert.equal(translate("no.such.key", "en"), "no.such.key");
  assert.equal(
    currentLanguage(new MemoryStorage({ "fontra-language-language": "ja" })),
    "ja"
  );
  assert.equal(currentLanguage(new MemoryStorage()), "en");
});
