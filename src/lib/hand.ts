
/**
 * Screen-space agent cursor (the hotspot the hand icon is pinned to).
 *
 * Two things move it:
 *   - `easeHandToward(target)` eases from wherever the hand is to a target
 *     that is re-read every frame (the reach to the intake pile, whose front
 *     card may still be settling).
 *   - `moveHand()` per-frame writes from the flight controller (lib/carry.ts)
 *     while the hand is holding a card: the hand is then attached to the card,
 *     never the other way round.
 * The position never teleports to a phase target.
 */
type Listener = () => void;
type Pt = { x: number; y: number };

let x = 228;
let y = 78;
let rot = 0;
let fromX = 228;
let fromY = 78;
let target: (() => Pt) | null = null;
let start = 0;
let duration = 0;
let arc = 0;
let raf = 0;
let timer = 0;
let resolve: (() => void) | null = null;
const listeners = new Set<Listener>();

const HAND_MIN_MS = 360;
const HAND_MAX_MS = 920;
const HAND_BASE_MS = 270;
const HAND_MS_PER_PX = 0.55;

function emit() {
  for (const listener of listeners) listener();
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function easeInOutQuart(t: number) {
  return t < 0.5 ? 8 * t * t * t * t : 1 - (-2 * t + 2) ** 4 / 2;
}

function clearSchedulers() {
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  if (timer) {
    clearTimeout(timer);
    timer = 0;
  }
}

function finish() {
  clearSchedulers();
  duration = 0;
  target = null;
  const done = resolve;
  resolve = null;
  done?.();
}

function schedule() {
  raf = requestAnimationFrame(tick);
  // Background tabs throttle rAF; the timer keeps the promise chain moving.
  timer = window.setTimeout(() => tick(performance.now()), 32);
}

function tick(now: number) {
  clearSchedulers();
  const to = target ? target() : { x, y };
  const t = duration <= 0 ? 1 : Math.min(1, (now - start) / duration);
  const e = easeInOutQuart(t);
  const dx = to.x - fromX;
  const dy = to.y - fromY;
  const mx = fromX + dx * e;
  const my = fromY + dy * e;
  const len = Math.hypot(dx, dy) || 1;
  const lift = Math.sin(t * Math.PI) * arc;
  x = mx + (-dy / len) * lift;
  y = my + (dx / len) * lift;
  const heading = (Math.atan2(dy, dx) * 180) / Math.PI;
  rot = t > 0.85 ? 0 : Math.max(-10, Math.min(10, heading * 0.12));
  if (t >= 1) {
    x = to.x;
    y = to.y;
    rot = 0;
    emit();
    finish();
    return;
  }
  emit();
  schedule();
}

function handDuration(dist: number) {
  return Math.min(HAND_MAX_MS, Math.max(HAND_MIN_MS, HAND_BASE_MS + dist * HAND_MS_PER_PX));
}

export function getHand() {
  return { x, y, rot };
}

export function subscribeHand(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Per-frame write from the flight controller. Emits so the figure re-pins. */
export function moveHand(nx: number, ny: number, tilt = 0) {
  x = nx;
  y = ny;
  rot = tilt;
  emit();
}

/** Stop a running ease where it is (its promise resolves). */
export function cancelHandEase() {
  if (!raf && !timer && !resolve) return;
  finish();
}

/**
 * Ease from the current pixel to a live screen target. Slight arc so it
 * reads as a cursor, not a slide. Resolves when the hand arrives.
 */
export function easeHandToward(getTarget: () => Pt, ms?: number): Promise<void> {
  cancelHandEase();
  const to = getTarget();
  const dist = Math.hypot(to.x - x, to.y - y);
  fromX = x;
  fromY = y;
  target = getTarget;
  if (dist < 1.2 || prefersReducedMotion()) {
    x = to.x;
    y = to.y;
    rot = 0;
    target = null;
    emit();
    return Promise.resolve();
  }
  start = performance.now();
  duration = ms ?? handDuration(dist);
  arc = Math.min(36, dist * 0.12);
  return new Promise((done) => {
    resolve = done;
    schedule();
  });
}

export function easeHandTo(nx: number, ny: number, ms?: number): Promise<void> {
  const fixed = { x: nx, y: ny };
  return easeHandToward(() => fixed, ms);
}
