
/**
 * Stable per-card jitter so the intake pile looks shuffled, not a perfect
 * deck. The front card is always squared up: it is "next", and the hand
 * picks it up exactly where it lies.
 */
export function intakeScatter(id: string, front: boolean) {
  if (front) return { ox: 0, oy: 0, rot: 0 };
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const a = ((h >>> 0) % 1000) / 1000;
  const b = ((h >>> 10) % 1000) / 1000;
  const c = ((h >>> 20) % 1000) / 1000;
  return {
    ox: Math.round((a - 0.5) * 18),
    oy: Math.round((b - 0.5) * 12),
    rot: +((c - 0.5) * 11).toFixed(2),
  };
}
