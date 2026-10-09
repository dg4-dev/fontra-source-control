// Turns glyph model contours (see glyph-model.js) into SVG path data, and
// resolves components into plain contours.

import { multiply, transformPoint } from "./affine.js";

export function contoursToPathData(contours) {
  return contours.map(contourToPathData).filter(Boolean).join(" ");
}

export function contourToPathData(contour) {
  const points = contour.points;
  const count = points.length;
  if (!count) {
    return "";
  }
  let sequence;
  let start;
  if (contour.closed) {
    const firstOn = points.findIndex((p) => p.on);
    if (firstOn < 0) {
      // TrueType ring of only off-curve points: start at an implied on-curve
      start = midpoint(points[count - 1], points[0]);
      sequence = [...points, { ...start, on: true }];
    } else {
      start = points[firstOn];
      sequence = [];
      for (let i = 1; i <= count; i++) {
        sequence.push(points[(firstOn + i) % count]);
      }
    }
  } else {
    start = points[0];
    sequence = points.slice(1);
  }

  const commands = [`M${fmt(start.x)} ${fmt(start.y)}`];
  let current = start;
  let offCurves = [];
  sequence.forEach((point, index) => {
    if (!point.on) {
      offCurves.push(point);
      return;
    }
    const closingLine =
      contour.closed && index === sequence.length - 1 && !offCurves.length;
    if (!closingLine) {
      // "Z" draws the closing straight line by itself
      commands.push(segmentCommands(current, offCurves, point));
    }
    offCurves = [];
    current = point;
  });
  if (!contour.closed && offCurves.length) {
    // Dangling off-curve points at the end of an open contour
    for (const point of offCurves) {
      commands.push(`L${fmt(point.x)} ${fmt(point.y)}`);
    }
  }
  if (contour.closed) {
    commands.push("Z");
  }
  return commands.join(" ");
}

function segmentCommands(startPoint, offCurves, end) {
  if (!offCurves.length) {
    return `L${fmt(end.x)} ${fmt(end.y)}`;
  }
  if (offCurves.some((p) => p.kind === "quad")) {
    // Quadratic spline with implied on-curve points between the controls
    const commands = [];
    for (let i = 0; i < offCurves.length - 1; i++) {
      const implied = midpoint(offCurves[i], offCurves[i + 1]);
      commands.push(
        `Q${fmt(offCurves[i].x)} ${fmt(offCurves[i].y)} ${fmt(implied.x)} ${fmt(implied.y)}`
      );
    }
    const last = offCurves.at(-1);
    commands.push(`Q${fmt(last.x)} ${fmt(last.y)} ${fmt(end.x)} ${fmt(end.y)}`);
    return commands.join(" ");
  }
  if (offCurves.length === 1) {
    const c = offCurves[0];
    return `Q${fmt(c.x)} ${fmt(c.y)} ${fmt(end.x)} ${fmt(end.y)}`;
  }
  if (offCurves.length === 2) {
    const [c1, c2] = offCurves;
    return `C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(end.x)} ${fmt(end.y)}`;
  }
  return decomposeSuperBezier([...offCurves, end])
    .map(
      ([c1, c2, p]) =>
        `C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p.x)} ${fmt(p.y)}`
    )
    .join(" ");
}

// Port of fontTools.pens.basePen.decomposeSuperBezierSegment: a cubic
// segment with more than two off-curve points becomes several cubics.
export function decomposeSuperBezier(points) {
  const n = points.length - 1;
  const segments = [];
  let pt1 = points[0];
  let pt2 = null;
  for (let i = 2; i <= n; i++) {
    const divisions = Math.min(i, 3, n - i + 2);
    for (let j = 1; j < divisions; j++) {
      const factor = j / divisions;
      const a = points[i - 2];
      const b = points[i - 1];
      const temp = { x: a.x + factor * (b.x - a.x), y: a.y + factor * (b.y - a.y) };
      if (pt2 === null) {
        pt2 = temp;
      } else {
        const pt3 = midpoint(pt2, temp);
        segments.push([pt1, pt2, pt3]);
        pt1 = temp;
        pt2 = null;
      }
    }
  }
  segments.push([pt1, points[n - 1], points[n]]);
  return segments;
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function fmt(value) {
  return String(Math.round(value * 100) / 100);
}

export function transformContours(contours, transform) {
  return contours.map((contour) => ({
    closed: contour.closed,
    points: contour.points.map((point) => {
      const [x, y] = transformPoint(transform, point.x, point.y);
      return { ...point, x, y };
    }),
  }));
}

// Contours of the components of a layer, with their transforms applied.
// getLayer(name) returns the base glyph's layer (or null when unavailable).
// Returns { contours, missing } where missing lists base glyphs not found.
export function flattenComponents(layer, getLayer, maxDepth = 8) {
  const contours = [];
  const missing = new Set();
  const visit = (currentLayer, transform, depth, seen) => {
    for (const component of currentLayer.components) {
      const base = getLayer(component.name);
      if (!base || seen.has(component.name) || depth >= maxDepth) {
        missing.add(component.name);
        continue;
      }
      // The component transform applies first, then the enclosing one
      const t = multiply(transform, component.transform);
      contours.push(...transformContours(base.contours, t));
      visit(base, t, depth + 1, new Set([...seen, component.name]));
    }
  };
  visit(layer, [1, 0, 0, 1, 0, 0], 0, new Set());
  return { contours, missing: [...missing] };
}

// Bounding box of the points of some contours, or null when there are none
export function contoursBounds(contours) {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const contour of contours) {
    for (const p of contour.points) {
      xMin = Math.min(xMin, p.x);
      yMin = Math.min(yMin, p.y);
      xMax = Math.max(xMax, p.x);
      yMax = Math.max(yMax, p.y);
    }
  }
  return xMin === Infinity ? null : { xMin, yMin, xMax, yMax };
}

export function unionBounds(...boxes) {
  const present = boxes.filter(Boolean);
  if (!present.length) {
    return null;
  }
  return {
    xMin: Math.min(...present.map((b) => b.xMin)),
    yMin: Math.min(...present.map((b) => b.yMin)),
    xMax: Math.max(...present.map((b) => b.xMax)),
    yMax: Math.max(...present.map((b) => b.yMax)),
  };
}
