// SVG drawing of glyph outlines for the diff view: the old and new version of
// a layer overlaid or side by side, and kerning pairs at their old and new
// spacing. Glyph coordinates are y-up; the drawing flips them.

import { contoursBounds, contoursToPathData, unionBounds } from "../formats/outline.js";
import { svg } from "./dom.js";

// A pannable, zoomable SVG. draw(group, view) fills the y-flipped group;
// view.px is the size of one screen pixel in glyph units, for markers.
export class GlyphCanvas {
  constructor(className = "glyph-canvas") {
    this.element = svg("svg", {
      class: className,
      preserveAspectRatio: "xMidYMid meet",
    });
    this.content = svg("g");
    this.element.append(this.content);
    this.bounds = null;
    this.view = null;
    this.draw = null;
    this.linked = [];
    this._installInteraction();
    this._resizeObserver = new ResizeObserver(() => this.render());
    this._resizeObserver.observe(this.element);
  }

  // bounds: { xMin, yMin, xMax, yMax } in glyph units
  setContent(bounds, draw, { keepView = false } = {}) {
    this.bounds = bounds;
    this.draw = draw;
    if (!keepView || !this.view) {
      this.resetView(false);
    }
    this.render();
  }

  // Canvases that pan and zoom together (side by side view)
  link(other) {
    this.linked.push(other);
    other.linked.push(this);
  }

  resetView(render = true) {
    const b = this.bounds ?? { xMin: 0, yMin: 0, xMax: 1000, yMax: 1000 };
    const width = Math.max(b.xMax - b.xMin, 1);
    const height = Math.max(b.yMax - b.yMin, 1);
    const margin = Math.max(width, height) * 0.08;
    this.view = {
      x: b.xMin - margin,
      y: -b.yMax - margin,
      width: width + 2 * margin,
      height: height + 2 * margin,
    };
    if (render) {
      this.render();
    }
  }

  get pixelSize() {
    const rect = this.element.getBoundingClientRect();
    if (!rect.width || !rect.height || !this.view) {
      return 1;
    }
    return Math.max(this.view.width / rect.width, this.view.height / rect.height);
  }

  render() {
    if (!this.view || !this.draw) {
      return;
    }
    const { x, y, width, height } = this.view;
    this.element.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
    const group = svg("g", { transform: "scale(1,-1)" });
    this.draw(group, { px: this.pixelSize });
    this.content.replaceChildren(group);
  }

  _setView(view, propagate = true) {
    this.view = view;
    this.render();
    if (propagate) {
      for (const other of this.linked) {
        other._setView({ ...view }, false);
      }
    }
  }

  _installInteraction() {
    const element = this.element;
    element.addEventListener(
      "wheel",
      (event) => {
        if (!this.view) {
          return;
        }
        event.preventDefault();
        const rect = element.getBoundingClientRect();
        const factor = Math.exp(event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015));
        const point = this._toView(event.clientX, event.clientY, rect);
        const view = this.view;
        const width = view.width * factor;
        const height = view.height * factor;
        this._setView({
          x: point.x - (point.x - view.x) * factor,
          y: point.y - (point.y - view.y) * factor,
          width,
          height,
        });
      },
      { passive: false }
    );
    let drag = null;
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !this.view) {
        return;
      }
      element.setPointerCapture(event.pointerId);
      drag = { x: event.clientX, y: event.clientY, view: { ...this.view } };
      element.style.cursor = "grabbing";
    });
    element.addEventListener("pointermove", (event) => {
      if (!drag) {
        return;
      }
      const px = this.pixelSize;
      this._setView({
        ...drag.view,
        x: drag.view.x - (event.clientX - drag.x) * px,
        y: drag.view.y - (event.clientY - drag.y) * px,
      });
    });
    const endDrag = () => {
      drag = null;
      element.style.cursor = "";
    };
    element.addEventListener("pointerup", endDrag);
    element.addEventListener("pointercancel", endDrag);
    element.addEventListener("dblclick", () => {
      this.resetView(false);
      this._setView(this.view);
    });
  }

  // Screen point → view box coordinates, honoring preserveAspectRatio meet
  _toView(clientX, clientY, rect) {
    const view = this.view;
    const scaleFactor = Math.max(view.width / rect.width, view.height / rect.height);
    const offsetX = (rect.width * scaleFactor - view.width) / 2;
    const offsetY = (rect.height * scaleFactor - view.height) / 2;
    return {
      x: view.x - offsetX + (clientX - rect.left) * scaleFactor,
      y: view.y - offsetY + (clientY - rect.top) * scaleFactor,
    };
  }
}

// Bounds covering both versions of a layer, their advance boxes and anchors
export function layerPairBounds(oldDrawing, newDrawing) {
  const boxes = [];
  for (const drawing of [oldDrawing, newDrawing]) {
    if (!drawing) {
      continue;
    }
    boxes.push(
      contoursBounds(drawing.contours),
      contoursBounds(drawing.componentContours)
    );
    boxes.push({ xMin: 0, yMin: 0, xMax: drawing.layer.advance || 0, yMax: 0 });
    for (const anchor of drawing.layer.anchors) {
      boxes.push({ xMin: anchor.x, yMin: anchor.y, xMax: anchor.x, yMax: anchor.y });
    }
  }
  const bounds = unionBounds(...boxes) ?? { xMin: 0, yMin: 0, xMax: 500, yMax: 700 };
  if (bounds.yMax - bounds.yMin < 100) {
    bounds.yMax = bounds.yMin + 700;
  }
  return bounds;
}

// drawing: { layer, contours, componentContours }
export function drawMetrics(
  group,
  drawing,
  { px, color = "var(--sc-metrics)", dashed = false }
) {
  const advance = drawing.layer.advance || 0;
  const extent = 5000;
  const dash = dashed ? `${4 * px} ${3 * px}` : null;
  group.append(
    svg("line", {
      "x1": -extent,
      "y1": 0,
      "x2": extent,
      "y2": 0,
      "stroke": "var(--sc-metrics)",
      "stroke-width": px,
    }),
    svg("line", {
      "x1": 0,
      "y1": -extent,
      "x2": 0,
      "y2": extent,
      "stroke": color,
      "stroke-width": px,
      "stroke-dasharray": dash,
    }),
    svg("line", {
      "x1": advance,
      "y1": -extent,
      "x2": advance,
      "y2": extent,
      "stroke": color,
      "stroke-width": px,
      "stroke-dasharray": dash,
    })
  );
}

export function drawOutline(
  group,
  contours,
  { fill, stroke, px, dashed = false, width = 1 }
) {
  const d = contoursToPathData(contours);
  if (!d) {
    return;
  }
  group.append(
    svg("path", {
      "d": d,
      "fill": fill,
      "fill-rule": "nonzero",
      "stroke": stroke,
      "stroke-width": width * px,
      "stroke-dasharray": dashed ? `${5 * px} ${3 * px}` : null,
      "stroke-linejoin": "round",
    })
  );
}

// Points and handles. highlight: Set of "contour:point" keys drawn in color.
export function drawPoints(
  group,
  contours,
  { px, color, highlight = null, highlightColor }
) {
  const handles = [];
  const markers = [];
  contours.forEach((contour, contourIndex) => {
    const points = contour.points;
    points.forEach((point, pointIndex) => {
      const key = `${contourIndex}:${pointIndex}`;
      const isHighlighted = highlight?.has(key);
      const fillColor = isHighlighted ? highlightColor : color;
      const size = (isHighlighted ? 4.5 : 3.2) * px;
      if (point.on) {
        markers.push(
          point.smooth
            ? svg("circle", { cx: point.x, cy: point.y, r: size, fill: fillColor })
            : svg("rect", {
                x: point.x - size,
                y: point.y - size,
                width: 2 * size,
                height: 2 * size,
                fill: fillColor,
              })
        );
      } else {
        markers.push(
          svg("circle", {
            "cx": point.x,
            "cy": point.y,
            "r": size * 0.8,
            "fill": "var(--sc-background)",
            "stroke": fillColor,
            "stroke-width": 1.2 * px,
          })
        );
        // Handle lines to the neighboring on-curve points
        for (const neighbor of [pointIndex - 1, pointIndex + 1]) {
          if (!contour.closed && (neighbor < 0 || neighbor >= points.length)) {
            continue;
          }
          const other = points[(neighbor + points.length) % points.length];
          if (other.on) {
            handles.push(
              svg("line", {
                "x1": point.x,
                "y1": point.y,
                "x2": other.x,
                "y2": other.y,
                "stroke": color,
                "stroke-opacity": 0.6,
                "stroke-width": px,
              })
            );
          }
        }
      }
    });
  });
  group.append(...handles, ...markers);
}

// Arrows from old to new positions of moved points
export function drawMoves(group, moves, { px, color }) {
  for (const move of moves) {
    const dx = move.to.x - move.from.x;
    const dy = move.to.y - move.from.y;
    const length = Math.hypot(dx, dy);
    group.append(
      svg("line", {
        "x1": move.from.x,
        "y1": move.from.y,
        "x2": move.to.x,
        "y2": move.to.y,
        "stroke": color,
        "stroke-width": 1.5 * px,
      })
    );
    if (length > 6 * px) {
      const ux = dx / length;
      const uy = dy / length;
      const head = 6 * px;
      const points = [
        [move.to.x, move.to.y],
        [
          move.to.x - ux * head - uy * head * 0.5,
          move.to.y - uy * head + ux * head * 0.5,
        ],
        [
          move.to.x - ux * head + uy * head * 0.5,
          move.to.y - uy * head - ux * head * 0.5,
        ],
      ];
      group.append(
        svg("polygon", {
          points: points.map((p) => p.join(",")).join(" "),
          fill: color,
        })
      );
    }
  }
}

export function drawLoosePoints(group, points, { px, color }) {
  for (const point of points) {
    const size = 4.5 * px;
    group.append(
      svg("circle", {
        "cx": point.x,
        "cy": point.y,
        "r": size,
        "fill": "none",
        "stroke": color,
        "stroke-width": 2 * px,
      })
    );
  }
}

export function drawAnchors(group, anchors, { px, color }) {
  for (const anchor of anchors) {
    const size = 4 * px;
    group.append(
      svg("polygon", {
        points: [
          [anchor.x, anchor.y + size],
          [anchor.x + size, anchor.y],
          [anchor.x, anchor.y - size],
          [anchor.x - size, anchor.y],
        ]
          .map((p) => p.join(","))
          .join(" "),
        fill: color,
      })
    );
  }
}

export function drawLabel(
  group,
  text,
  x,
  y,
  { px, color, anchor = "start", size = 11 }
) {
  // Text must not be mirrored by the group's y flip
  group.append(
    svg(
      "text",
      {
        "x": x,
        "y": -y,
        "transform": "scale(1,-1)",
        "fill": color,
        "font-size": size * px,
        "text-anchor": anchor,
        "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
      },
      document.createTextNode(text)
    )
  );
}

// Fill-based diff of two shapes: the area only in the old shape is red, the
// area only in the new shape is green and the area they share is gray.
// which: "both" (overlay), "old" or "new" (one side of a side-by-side view;
// each side shows its own shape with the same colors).
let maskCounter = 0;
const FAR = 100000;

export function drawFillDiff(group, oldContours, newContours, { which = "both" } = {}) {
  const oldD = oldContours ? contoursToPathData(oldContours) : "";
  const newD = newContours ? contoursToPathData(newContours) : "";
  const defs = svg("defs");
  group.append(defs);
  const makeMask = (d, inside) => {
    const id = `sc-diff-mask-${++maskCounter}`;
    const mask = svg("mask", {
      id,
      maskUnits: "userSpaceOnUse",
      x: -FAR,
      y: -FAR,
      width: 2 * FAR,
      height: 2 * FAR,
    });
    mask.append(
      svg("rect", {
        x: -FAR,
        y: -FAR,
        width: 2 * FAR,
        height: 2 * FAR,
        fill: inside ? "black" : "white",
      })
    );
    if (d) {
      mask.append(
        svg("path", {
          "d": d,
          "fill": inside ? "white" : "black",
          "fill-rule": "nonzero",
        })
      );
    }
    defs.append(mask);
    return `url(#${id})`;
  };
  const fill = (d, color, mask) => {
    if (d) {
      group.append(
        svg("path", { "d": d, "fill": color, "fill-rule": "nonzero", "mask": mask })
      );
    }
  };
  if (which !== "new") {
    // Old shape: shared part gray, part not in the new shape red
    if (which === "old") {
      fill(oldD, "var(--sc-common-fill)", makeMask(newD, true));
    }
    fill(oldD, "var(--sc-removed-fill)", makeMask(newD, false));
  }
  if (which !== "old") {
    fill(newD, "var(--sc-common-fill)", makeMask(oldD, true));
    fill(newD, "var(--sc-added-fill)", makeMask(oldD, false));
  }
}
