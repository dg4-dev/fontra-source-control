// 2D affine transforms as [xx, xy, yx, yy, dx, dy], with the same composition
// order as fontTools' and Fontra's Transform: t.translate(...).rotate(...)
// applies the rotation first, then the translation.

export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

export function multiply(self, other) {
  const [xx1, xy1, yx1, yy1, dx1, dy1] = other;
  const [xx2, xy2, yx2, yy2, dx2, dy2] = self;
  return [
    xx1 * xx2 + xy1 * yx2,
    xx1 * xy2 + xy1 * yy2,
    yx1 * xx2 + yy1 * yx2,
    yx1 * xy2 + yy1 * yy2,
    xx2 * dx1 + yx2 * dy1 + dx2,
    xy2 * dx1 + yy2 * dy1 + dy2,
  ];
}

export function translate(t, x, y) {
  return multiply(t, [1, 0, 0, 1, x, y]);
}

export function scale(t, x, y = x) {
  return multiply(t, [x, 0, 0, y, 0, 0]);
}

export function rotate(t, radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return multiply(t, [c, s, -s, c, 0, 0]);
}

export function skew(t, x, y = 0) {
  return multiply(t, [1, Math.tan(y), Math.tan(x), 1, 0, 0]);
}

export function transformPoint(t, x, y) {
  const [xx, xy, yx, yy, dx, dy] = t;
  return [xx * x + yx * y + dx, xy * x + yy * y + dy];
}

// Fontra's DecomposedTransform (degrees for rotation and skew)
export function fromDecomposed(d = {}) {
  const value = (key, fallback) => (Number.isFinite(d[key]) ? d[key] : fallback);
  const tCenterX = value("tCenterX", 0);
  const tCenterY = value("tCenterY", 0);
  let t = IDENTITY;
  t = translate(
    t,
    value("translateX", 0) + tCenterX,
    value("translateY", 0) + tCenterY
  );
  t = rotate(t, (value("rotation", 0) * Math.PI) / 180);
  t = scale(t, value("scaleX", 1), value("scaleY", 1));
  t = skew(t, (value("skewX", 0) * Math.PI) / 180, (value("skewY", 0) * Math.PI) / 180);
  t = translate(t, -tCenterX, -tCenterY);
  return t;
}

export function isIdentity(t) {
  return t.every((value, i) => Math.abs(value - IDENTITY[i]) < 1e-9);
}
