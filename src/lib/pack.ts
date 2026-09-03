
/** Pack variable-size boxes around a point. No rows or columns. */

export type PackItem = { id: string; w: number; h: number };
export type PackedBox = { id: string; x: number; y: number; w: number; h: number };

const TAU = Math.PI * 2;
const STEPS = 22;
const GAP = 16;

function hash01(id: string, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function overlaps(a: PackedBox, b: PackedBox, gap: number) {
  return !(
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  );
}

function radius(item: { w: number; h: number }) {
  return Math.hypot(item.w, item.h) * 0.5;
}

/**
 * Pack `items` around (cx, cy). Boxes in `fixed` are already on the wall and
 * never move: new items nestle against them (and each other) at hash-shifted
 * angles so the cluster reads as a packed mess, not a grid. With no fixed
 * boxes the largest item sits at the centre. Returns only the new boxes.
 */
export function packAround(
  items: PackItem[],
  cx: number,
  cy: number,
  fixed: readonly PackedBox[] = [],
): PackedBox[] {
  if (items.length === 0) return [];
  const ordered = items.slice().sort((a, b) => {
    const d = b.w * b.h - a.w * a.h;
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });
  const placed: PackedBox[] = fixed.slice();
  const added: PackedBox[] = [];
  const put = (box: PackedBox) => {
    placed.push(box);
    added.push(box);
  };

  for (const item of ordered) {
    if (placed.length === 0) {
      const nudgeX = (hash01(item.id, 1) - 0.5) * 18;
      const nudgeY = (hash01(item.id, 2) - 0.5) * 18;
      put({
        id: item.id,
        x: cx - item.w / 2 + nudgeX,
        y: cy - item.h / 2 + nudgeY,
        w: item.w,
        h: item.h,
      });
      continue;
    }

    let best: PackedBox | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const ir = radius(item);

    for (const other of placed) {
      const or_ = radius(other);
      const dist = or_ + ir + GAP;
      const ox = other.x + other.w / 2;
      const oy = other.y + other.h / 2;
      const spin = hash01(item.id + other.id) * TAU;
      for (let s = 0; s < STEPS; s++) {
        const angle = spin + (s * TAU) / STEPS;
        const next: PackedBox = {
          id: item.id,
          x: ox + Math.cos(angle) * dist - item.w / 2,
          y: oy + Math.sin(angle) * dist - item.h / 2,
          w: item.w,
          h: item.h,
        };
        if (placed.some((box) => overlaps(next, box, GAP))) continue;
        const mx = next.x + next.w / 2 - cx;
        const my = next.y + next.h / 2 - cy;
        const score = mx * mx + my * my + s * 12;
        if (score < bestScore) {
          bestScore = score;
          best = next;
        }
      }
    }

    if (!best) {
      const ring = 1 + placed.length;
      const angle = hash01(item.id, 7) * TAU;
      best = {
        id: item.id,
        x: cx + Math.cos(angle) * ring * 80 - item.w / 2,
        y: cy + Math.sin(angle) * ring * 80 - item.h / 2,
        w: item.w,
        h: item.h,
      };
    }
    put(best);
  }

  return added;
}

export type Pt = { x: number; y: number };

/** Monotone-chain hull, clockwise. */
export function convexHull(points: Pt[]): Pt[] {
  if (points.length <= 2) return points.slice();
  const pts = points
    .slice()
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Rounded closed path through a hull. */
export function roundedHull(points: Pt[], radius = 44): string {
  const hull = convexHull(points);
  if (hull.length === 0) return "";
  if (hull.length === 1) {
    const p = hull[0];
    return `M${p.x - radius} ${p.y} a${radius} ${radius} 0 1 0 ${radius * 2} 0 a${radius} ${radius} 0 1 0 ${-radius * 2} 0z`;
  }
  if (hull.length === 2) {
    const [a, b] = hull;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * radius;
    const ny = (dx / len) * radius;
    return `M${a.x + nx} ${a.y + ny} L${b.x + nx} ${b.y + ny} A${radius} ${radius} 0 0 1 ${b.x - nx} ${b.y - ny} L${a.x - nx} ${a.y - ny} A${radius} ${radius} 0 0 1 ${a.x + nx} ${a.y + ny}z`;
  }
  let d = "";
  for (let i = 0; i < hull.length; i++) {
    const prev = hull[(i - 1 + hull.length) % hull.length];
    const p = hull[i];
    const next = hull[(i + 1) % hull.length];
    const inLen = Math.hypot(p.x - prev.x, p.y - prev.y) || 1;
    const outLen = Math.hypot(next.x - p.x, next.y - p.y) || 1;
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const ax = p.x + ((prev.x - p.x) / inLen) * r;
    const ay = p.y + ((prev.y - p.y) / inLen) * r;
    const bx = p.x + ((next.x - p.x) / outLen) * r;
    const by = p.y + ((next.y - p.y) / outLen) * r;
    d += (i === 0 ? `M${ax} ${ay}` : `L${ax} ${ay}`) + `Q${p.x} ${p.y} ${bx} ${by}`;
  }
  return `${d}z`;
}

export function paddedCorners(box: PackedBox, pad: number): Pt[] {
  return [
    { x: box.x - pad, y: box.y - pad },
    { x: box.x + box.w + pad, y: box.y - pad },
    { x: box.x + box.w + pad, y: box.y + box.h + pad },
    { x: box.x - pad, y: box.y + box.h + pad },
  ];
}
