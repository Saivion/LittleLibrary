
/**
 * Dev-only render counters. Used by the stress harness to prove which React
 * components commit during pan / upload / placement. Stripped from production
 * by the NODE_ENV check (the increments become no-ops).
 */
export const counters = { app: 0, layer: 0, tile: 0, intake: 0, agent: 0, carry: 0 };

const DEV = process.env.NODE_ENV !== "production";

export function count(key: keyof typeof counters) {
  if (DEV) counters[key] += 1;
}

export function resetCounters() {
  for (const key of Object.keys(counters) as (keyof typeof counters)[]) counters[key] = 0;
}
