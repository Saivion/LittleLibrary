
/**
 * Screen-space quads and the projective transform that maps a card's own
 * box onto one. The card in the agent's hand is a plain DOM element; giving
 * it `matrix3d(H)` makes it coincide pixel-for-pixel with where the pile
 * drew it (measured) and where the wall will draw it (projected), so the
 * pick-up and the drop are continuous instead of cuts.
 */

export type Pt = { x: number; y: number };
/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];
/** Row-major 3×3 homography. */
export type Homography = [number, number, number, number, number, number, number, number, number];

export function rectQuad(x: number, y: number, w: number, h: number): Quad {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

export function lerpQuad(a: Quad, b: Quad, t: number): Quad {
  return [
    { x: a[0].x + (b[0].x - a[0].x) * t, y: a[0].y + (b[0].y - a[0].y) * t },
    { x: a[1].x + (b[1].x - a[1].x) * t, y: a[1].y + (b[1].y - a[1].y) * t },
    { x: a[2].x + (b[2].x - a[2].x) * t, y: a[2].y + (b[2].y - a[2].y) * t },
    { x: a[3].x + (b[3].x - a[3].x) * t, y: a[3].y + (b[3].y - a[3].y) * t },
  ];
}

export function offsetQuad(q: Quad, dx: number, dy: number): Quad {
  if (dx === 0 && dy === 0) return q;
  return [
    { x: q[0].x + dx, y: q[0].y + dy },
    { x: q[1].x + dx, y: q[1].y + dy },
    { x: q[2].x + dx, y: q[2].y + dy },
    { x: q[3].x + dx, y: q[3].y + dy },
  ];
}

export function quadCenter(q: Quad): Pt {
  return {
    x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
  };
}

/** Grow or shrink a quad about its centre. */
export function scaleQuad(q: Quad, s: number): Quad {
  if (s === 1) return q;
  const c = quadCenter(q);
  return [
    { x: c.x + (q[0].x - c.x) * s, y: c.y + (q[0].y - c.y) * s },
    { x: c.x + (q[1].x - c.x) * s, y: c.y + (q[1].y - c.y) * s },
    { x: c.x + (q[2].x - c.x) * s, y: c.y + (q[2].y - c.y) * s },
    { x: c.x + (q[3].x - c.x) * s, y: c.y + (q[3].y - c.y) * s },
  ];
}

/** Largest corner-to-corner distance between two quads (px). */
export function quadDelta(a: Quad, b: Quad): number {
  let max = 0;
  for (let i = 0; i < 4; i++) {
    const d = Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
    if (d > max) max = d;
  }
  return max;
}

/**
 * Homography taking the rectangle (0,0)–(w,h) onto `q` (Heckbert's
 * square-to-quad, then a pre-scale by 1/w, 1/h). Null when degenerate.
 */
export function rectToQuad(w: number, h: number, q: Quad): Homography | null {
  if (!(w > 0) || !(h > 0)) return null;
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;

  let a: number;
  let b: number;
  let d: number;
  let e: number;
  let g = 0;
  let hh = 0;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    // Affine (parallelogram).
    a = p1.x - p0.x;
    b = p2.x - p1.x;
    d = p1.y - p0.y;
    e = p2.y - p1.y;
  } else {
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < 1e-12) return null;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    hh = (dx1 * dy3 - dx3 * dy1) / det;
    a = p1.x - p0.x + g * p1.x;
    b = p3.x - p0.x + hh * p3.x;
    d = p1.y - p0.y + g * p1.y;
    e = p3.y - p0.y + hh * p3.y;
  }
  const c = p0.x;
  const f = p0.y;
  const H: Homography = [a / w, b / h, c, d / w, e / h, f, g / w, hh / h, 1];
  for (const v of H) if (!Number.isFinite(v)) return null;
  return H;
}

export function applyHomography(H: Homography, x: number, y: number): Pt {
  const wgt = H[6] * x + H[7] * y + H[8];
  const k = Math.abs(wgt) < 1e-12 ? 1 : 1 / wgt;
  return {
    x: (H[0] * x + H[1] * y + H[2]) * k,
    y: (H[3] * x + H[4] * y + H[5]) * k,
  };
}

/** CSS `matrix3d(...)` (column-major) encoding a 2D projective transform. */
export function homographyToMatrix3d(H: Homography): string {
  const n = (v: number) => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(6));
  return `matrix3d(${n(H[0])}, ${n(H[3])}, 0, ${n(H[6])}, ${n(H[1])}, ${n(H[4])}, 0, ${n(H[7])}, 0, 0, 1, 0, ${n(H[2])}, ${n(H[5])}, 0, ${n(H[8])})`;
}

/** Point at fractional (u, v) of the card once it is mapped onto the quad. */
export function quadPointAt(w: number, h: number, q: Quad, u: number, v: number): Pt {
  const H = rectToQuad(w, h, q);
  if (H) return applyHomography(H, u * w, v * h);
  // Bilinear fallback for degenerate quads.
  const top = { x: q[0].x + (q[1].x - q[0].x) * u, y: q[0].y + (q[1].y - q[0].y) * u };
  const bottom = { x: q[3].x + (q[2].x - q[3].x) * u, y: q[3].y + (q[2].y - q[3].y) * u };
  return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v };
}
