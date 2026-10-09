// Compares two versions of a glyph (glyph-model.js) layer by layer. The result
// is plain data; the diff view turns it into text and drawings.

const EPSILON = 1e-6;

// oldGlyph / newGlyph may be null (glyph added or deleted)
export function diffGlyph(oldGlyph, newGlyph) {
  const oldLayers = new Map((oldGlyph?.layers ?? []).map((layer) => [layer.id, layer]));
  const newLayers = new Map((newGlyph?.layers ?? []).map((layer) => [layer.id, layer]));
  const ids = [...new Set([...newLayers.keys(), ...oldLayers.keys()])];
  const layers = ids.map((id) =>
    diffLayer(oldLayers.get(id) ?? null, newLayers.get(id) ?? null)
  );
  const oldUnicodes = oldGlyph?.unicodes ?? [];
  const newUnicodes = newGlyph?.unicodes ?? [];
  const unicodesChanged = !sameNumbers(oldUnicodes, newUnicodes);
  return {
    name: newGlyph?.name || oldGlyph?.name || "",
    status: !oldGlyph ? "added" : !newGlyph ? "removed" : "modified",
    unicodes: unicodesChanged ? { old: oldUnicodes, new: newUnicodes } : null,
    layers,
    changed: unicodesChanged || layers.some((layer) => layer.status !== "unchanged"),
  };
}

export function diffLayer(oldLayer, newLayer) {
  const layer = newLayer ?? oldLayer;
  const result = {
    id: layer.id,
    name: layer.name,
    old: oldLayer,
    new: newLayer,
    status: "unchanged",
    changes: [],
    points: { moved: [], added: [], removed: [], sameStructure: true },
  };
  if (!oldLayer) {
    result.status = "added";
    return result;
  }
  if (!newLayer) {
    result.status = "removed";
    return result;
  }
  const changes = result.changes;

  if (Math.abs(oldLayer.advance - newLayer.advance) > EPSILON) {
    changes.push({ type: "advance", old: oldLayer.advance, new: newLayer.advance });
  }

  result.points = diffPoints(oldLayer.contours, newLayer.contours);
  if (oldLayer.contours.length !== newLayer.contours.length) {
    changes.push({
      type: "contours",
      old: oldLayer.contours.length,
      new: newLayer.contours.length,
    });
  }
  if (!result.points.sameStructure) {
    const oldCount = countPoints(oldLayer.contours);
    const newCount = countPoints(newLayer.contours);
    if (
      oldCount !== newCount ||
      oldLayer.contours.length === newLayer.contours.length
    ) {
      changes.push({ type: "points", old: oldCount, new: newCount });
    }
  } else if (result.points.moved.length) {
    changes.push({ type: "pointsMoved", count: result.points.moved.length });
  } else if (pointFlagsChanged(oldLayer.contours, newLayer.contours)) {
    changes.push({ type: "pointTypes" });
  }

  const componentChanges = diffNamedItems(
    oldLayer.components,
    newLayer.components,
    (a, b) => sameNumbers(a.transform, b.transform)
  );
  if (componentChanges) {
    changes.push({ type: "components", ...componentChanges });
  }
  const anchorChanges = diffNamedItems(
    oldLayer.anchors,
    newLayer.anchors,
    (a, b) => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON
  );
  if (anchorChanges) {
    changes.push({ type: "anchors", ...anchorChanges });
  }

  if (changes.length) {
    result.status = "modified";
  }
  return result;
}

// When every contour has the same number of points in both versions, points
// are compared by position in the list and moved points are reported. Else
// points that appear in only one version (by coordinates) are reported as
// added or removed.
export function diffPoints(oldContours, newContours) {
  const sameStructure =
    oldContours.length === newContours.length &&
    oldContours.every(
      (contour, i) =>
        contour.points.length === newContours[i].points.length &&
        contour.points.every((p, j) => p.on === newContours[i].points[j].on)
    );
  const moved = [];
  const added = [];
  const removed = [];
  if (sameStructure) {
    oldContours.forEach((contour, contourIndex) => {
      contour.points.forEach((oldPoint, pointIndex) => {
        const newPoint = newContours[contourIndex].points[pointIndex];
        if (
          Math.abs(oldPoint.x - newPoint.x) > EPSILON ||
          Math.abs(oldPoint.y - newPoint.y) > EPSILON
        ) {
          moved.push({
            contour: contourIndex,
            point: pointIndex,
            from: { x: oldPoint.x, y: oldPoint.y },
            to: { x: newPoint.x, y: newPoint.y },
            on: newPoint.on,
          });
        }
      });
    });
  } else {
    const oldKeys = countKeys(oldContours);
    const newKeys = countKeys(newContours);
    for (const contour of newContours) {
      for (const p of contour.points) {
        if (!takeKey(oldKeys, p)) {
          added.push({ x: p.x, y: p.y, on: p.on });
        }
      }
    }
    for (const contour of oldContours) {
      for (const p of contour.points) {
        if (!takeKey(newKeys, p)) {
          removed.push({ x: p.x, y: p.y, on: p.on });
        }
      }
    }
  }
  return { sameStructure, moved, added, removed };
}

function pointKey(p) {
  return `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)},${p.on ? 1 : 0}`;
}

function countKeys(contours) {
  const counts = new Map();
  for (const contour of contours) {
    for (const p of contour.points) {
      const key = pointKey(p);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function takeKey(counts, p) {
  const key = pointKey(p);
  const count = counts.get(key) ?? 0;
  if (!count) {
    return false;
  }
  counts.set(key, count - 1);
  return true;
}

function pointFlagsChanged(oldContours, newContours) {
  return oldContours.some(
    (contour, i) =>
      contour.closed !== newContours[i].closed ||
      contour.points.some(
        (p, j) =>
          p.smooth !== newContours[i].points[j].smooth ||
          p.kind !== newContours[i].points[j].kind
      )
  );
}

function countPoints(contours) {
  return contours.reduce((sum, contour) => sum + contour.points.length, 0);
}

// Components and anchors: matched by name, in order. Returns null when equal.
function diffNamedItems(oldItems, newItems, same) {
  const remaining = new Map();
  for (const item of oldItems) {
    if (!remaining.has(item.name)) {
      remaining.set(item.name, []);
    }
    remaining.get(item.name).push(item);
  }
  const added = [];
  const changed = [];
  for (const item of newItems) {
    const candidates = remaining.get(item.name);
    if (!candidates?.length) {
      added.push(item.name);
      continue;
    }
    const old = candidates.shift();
    if (!same(old, item)) {
      changed.push(item.name);
    }
  }
  const removed = [...remaining.values()].flat().map((item) => item.name);
  if (!added.length && !removed.length && !changed.length) {
    return null;
  }
  return { added, removed, changed };
}

function sameNumbers(a, b) {
  return (
    a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) < EPSILON)
  );
}

// For whole-font files (.glyphs): glyphs whose data differs between versions
export function changedGlyphNames(oldGlyphs, newGlyphs) {
  const names = [...new Set([...newGlyphs.keys(), ...oldGlyphs.keys()])];
  return names.filter((name) => {
    const oldGlyph = oldGlyphs.get(name);
    const newGlyph = newGlyphs.get(name);
    if (!oldGlyph || !newGlyph) {
      return true;
    }
    return JSON.stringify(oldGlyph) !== JSON.stringify(newGlyph);
  });
}
