// Parses the unified diff text that git prints into hunks of lines with old
// and new line numbers.

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

// Returns { binary, hunks: { header, oldStart, newStart, lines }[] } where each
// line is { type: "context" | "add" | "remove", text, oldLine, newLine }
export function parseUnifiedDiff(patch) {
  const hunks = [];
  let binary = false;
  let hunk = null;
  let oldLine = 0;
  let newLine = 0;
  for (const line of patch.split("\n")) {
    const header = line.match(HUNK_HEADER);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      hunk = {
        header: line,
        oldStart: oldLine,
        newStart: newLine,
        section: header[5].trim(),
        lines: [],
      };
      hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      if (line.startsWith("Binary files")) {
        binary = true;
      }
      continue;
    }
    const marker = line[0];
    const text = line.slice(1);
    if (marker === " ") {
      hunk.lines.push({
        type: "context",
        text,
        oldLine: oldLine++,
        newLine: newLine++,
      });
    } else if (marker === "-") {
      hunk.lines.push({ type: "remove", text, oldLine: oldLine++, newLine: null });
    } else if (marker === "+") {
      hunk.lines.push({ type: "add", text, oldLine: null, newLine: newLine++ });
    } else if (marker === "\\") {
      // "\ No newline at end of file"
      hunk.lines.at(-1) && (hunk.lines.at(-1).noNewline = true);
    } else if (line.startsWith("diff ")) {
      hunk = null;
    }
  }
  return { binary, hunks };
}

export function countChanges(parsed) {
  let added = 0;
  let removed = 0;
  for (const hunk of parsed.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") {
        added++;
      } else if (line.type === "remove") {
        removed++;
      }
    }
  }
  return { added, removed };
}
