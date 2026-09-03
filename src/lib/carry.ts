
/**
 * The card in flight. One face, three frames:
 *
 *   intake pile (screen)  ──pick up──▶  hand (screen ghost)  ──drop──▶  wall (world tile)
 *
 * The pile and the wall are drawn by React. This controller owns the frames
 * in between and the two hand-offs:
 *   - At pick-up it measures the pile card's exact on-screen quad (through
 *     its live CSS transform, so a card still settling is read where it is)
 *     and shows a screen-space ghost mapped onto that quad, in the same React
 *     commit that hides the pile card.
 *   - During the carry it projects the destination tile's quad every frame
 *     (wall yaw, card tilt, lift and jitter included) and morphs the ghost
 *     from the pile quad to it with a homography. The camera may travel or
 *     the user may pan; the target is re-projected, the ghost never snaps.
 *   - At the drop it waits for the wall tile to mount, then hides the ghost
 *     and reveals the tile in ONE commit. The tile is pixel-aligned with the
 *     ghost, so the only visible change is the shadow settling.
 *
 * The hand hotspot is attached to a fixed grip point on the card the whole
 * way, so the fist is always on the card it is holding.
 */
import { getCamera, setInboxAnchor, tileScreenQuad } from "./camera";
import { cancelHandEase, easeInOutQuart, moveHand, prefersReducedMotion } from "./hand";
import {
  homographyToMatrix3d,
  lerpQuad,
  offsetQuad,
  quadCenter,
  quadDelta,
  quadPointAt,
  rectQuad,
  rectToQuad,
  scaleQuad,
  type Pt,
  type Quad,
} from "./homography";
import { getLayout } from "./layout";
import { intakeFit, tileBox, type TileJitter } from "./media";
import { getTile } from "./store";
import { getTileElement } from "./ui";
import type { MediaType } from "./types";

export type Box = { x: number; y: number; w: number; h: number };
type Listener = () => void;

/** Where on the card the hand holds it (fraction of width / height). */
export const GRIP_U = 0.5;
export const GRIP_V = 0.2;

const LIFT_MS = 200;
const LIFT_SCALE = 1.04;
const LIFT_RISE_PX = 6;
const CORRECT_MS = 260;
const LANDING_MS = 420;
const MOUNT_TIMEOUT_MS = 600;
const VIEW_PAD_X = 48;
const VIEW_PAD_Y = 56;

/* ------------------------------------------------------------------ */
/* DOM registries (written by React refs, read here)                   */
/* ------------------------------------------------------------------ */

const intakeCards = new Map<string, HTMLElement>();
let intakeStack: HTMLElement | null = null;
let ghostEl: HTMLElement | null = null;

export function registerIntakeStack(element: HTMLElement | null) {
  intakeStack = element;
  if (element) {
    const r = element.getBoundingClientRect();
    setInboxAnchor(r.left + r.width / 2, r.top + r.height * 0.4);
  }
}

export function registerIntakeCard(id: string, element: HTMLElement | null) {
  if (element) intakeCards.set(id, element);
  else intakeCards.delete(id);
}

/** The ghost mounts already aligned: paint on registration, before first paint. */
export function registerCarryElement(element: HTMLElement | null) {
  ghostEl = element;
  if (element) paint();
}

/**
 * Exact screen quad of a pile card: its layout box pushed through the live
 * computed transform (origin 0 0), offset by the stack's position. Correct
 * mid-transition and mid-animation, which a bounding rect would not be.
 */
export function intakeCardQuad(id: string): Quad | null {
  const el = intakeCards.get(id);
  if (!el) return null;
  const base = (intakeStack ?? el.parentElement)?.getBoundingClientRect();
  if (!base) return null;
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  const cw = el.offsetWidth;
  const ch = el.offsetHeight;
  const map = (px: number, py: number): Pt => {
    const p = m.transformPoint(new DOMPoint(px, py));
    return { x: base.left + p.x, y: base.top + p.y };
  };
  return [map(0, 0), map(cw, 0), map(cw, ch), map(0, ch)];
}

/** Screen point the hand should reach for on a pile card. */
export function intakeGrip(id: string): Pt | null {
  const el = intakeCards.get(id);
  const q = intakeCardQuad(id);
  if (!el || !q) return null;
  return quadPointAt(el.offsetWidth, el.offsetHeight, q, GRIP_U, GRIP_V);
}

/* ------------------------------------------------------------------ */
/* React-facing snapshot                                               */
/* ------------------------------------------------------------------ */

export type CarrySnapshot = {
  /** Clip drawn by the ghost right now (pile card and wall tile hide themselves). */
  heldId: string | null;
  /** Tile that was just set down; plays the settle animation. */
  landingId: string | null;
};

let heldId: string | null = null;
let landingId: string | null = null;
let snapshot: CarrySnapshot = { heldId: null, landingId: null };
const SERVER_SNAPSHOT: CarrySnapshot = snapshot;
const listeners = new Set<Listener>();

function emitCarry() {
  snapshot = { heldId, landingId };
  for (const listener of listeners) listener();
}

export function subscribeCarry(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCarrySnapshot() {
  return snapshot;
}

export function getServerCarrySnapshot() {
  return SERVER_SNAPSHOT;
}

export function isHeld(id: string) {
  return heldId === id;
}

export function isLanding(id: string) {
  return landingId === id;
}

/* ------------------------------------------------------------------ */
/* Flight state                                                        */
/* ------------------------------------------------------------------ */

type Mode = "idle" | "lift" | "held" | "carry" | "hold" | "correct" | "follow";

let mode: Mode = "idle";
let flightId = "";
let cardW = 180;
let cardH = 220;
let jitter: TileJitter = { jx: 0, jy: 0, rot: 0 };
let targetBox: () => Box | undefined = () => undefined;
let lastTarget: Quad | null = null;
let fromQuad: Quad = rectQuad(0, 0, 1, 1);
let quad: Quad = fromQuad;
let start = 0;
let duration = 0;
let arcLift = 0;
let raf = 0;
let timer = 0;
let segmentDone: (() => void) | null = null;

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

function schedule() {
  if (raf || timer) return;
  raf = requestAnimationFrame(tick);
  timer = window.setTimeout(() => tick(performance.now()), 32);
}

function resolveSegment() {
  const done = segmentDone;
  segmentDone = null;
  done?.();
}

/** A timed leg of the flight; resolves from tick() when it completes. */
function segment(nextMode: Mode, ms: number): Promise<void> {
  resolveSegment();
  mode = nextMode;
  start = performance.now();
  duration = prefersReducedMotion() ? 0 : Math.max(0, ms);
  return new Promise((done) => {
    segmentDone = done;
    clearSchedulers();
    schedule();
  });
}

function clampToView(q: Quad): Quad {
  const { viewW, viewH } = getCamera();
  const c = quadCenter(q);
  const cx = Math.min(viewW - VIEW_PAD_X, Math.max(VIEW_PAD_X, c.x));
  const cy = Math.min(viewH - VIEW_PAD_Y, Math.max(VIEW_PAD_Y, c.y));
  return offsetQuad(q, cx - c.x, cy - c.y);
}

/** Destination quad, re-projected now; parked at the view edge if off screen. */
function targetQuad(): Quad {
  const box = targetBox();
  const projected = box ? tileScreenQuad(box, jitter) : null;
  if (projected) lastTarget = projected;
  return clampToView(lastTarget ?? quad);
}

function liftedQuad(q: Quad): Quad {
  return offsetQuad(scaleQuad(q, LIFT_SCALE), 0, -LIFT_RISE_PX);
}

function paint() {
  if (!ghostEl || heldId === null) return;
  const H = rectToQuad(cardW, cardH, quad);
  if (!H) return;
  ghostEl.style.transform = homographyToMatrix3d(H);
}

function placeHand(tilt = 0) {
  const grip = quadPointAt(cardW, cardH, quad, GRIP_U, GRIP_V);
  moveHand(grip.x, grip.y, tilt);
}

function tick(now: number) {
  clearSchedulers();
  if (mode === "idle" || mode === "held") return;
  const t = duration <= 0 ? 1 : Math.min(1, (now - start) / duration);
  const e = easeInOutQuart(t);
  let tilt = 0;

  switch (mode) {
    case "lift":
      quad = lerpQuad(fromQuad, liftedQuad(fromQuad), e);
      break;
    case "carry": {
      const to = targetQuad();
      const base = lerpQuad(fromQuad, to, e);
      const fc = quadCenter(fromQuad);
      const tc = quadCenter(to);
      const dx = tc.x - fc.x;
      const dy = tc.y - fc.y;
      const len = Math.hypot(dx, dy) || 1;
      const lift = Math.sin(t * Math.PI) * arcLift;
      quad = offsetQuad(base, (-dy / len) * lift, (dx / len) * lift);
      const heading = (Math.atan2(dy, dx) * 180) / Math.PI;
      tilt = t > 0.9 ? 0 : Math.max(-10, Math.min(10, heading * 0.12));
      break;
    }
    case "correct":
      quad = lerpQuad(fromQuad, targetQuad(), e);
      break;
    case "hold":
    case "follow":
      quad = targetQuad();
      break;
  }

  paint();
  placeHand(tilt);

  if (t >= 1 && (mode === "lift" || mode === "carry" || mode === "correct")) {
    // Lifted: rest in the hand until the carry starts. Arrived: keep
    // tracking the (possibly moving) destination until the drop.
    mode = mode === "lift" ? "held" : "hold";
    resolveSegment();
    if (mode === "held") return;
  }
  schedule();
}

/* ------------------------------------------------------------------ */
/* Public flight API (called by lib/agent.ts, in order)                */
/* ------------------------------------------------------------------ */

/**
 * Take the pile card `id` into the hand. The ghost appears exactly over the
 * pile card (which hides itself in the same commit) and lifts slightly.
 * Resolves when the lift is done.
 */
export function pickUpCard(
  id: string,
  getTarget: () => Box | undefined,
  pose: TileJitter,
  mediaType?: MediaType,
): Promise<void> {
  clearSchedulers();
  cancelHandEase();
  const box = tileBox(mediaType);
  flightId = id;
  cardW = box.w;
  cardH = box.h;
  jitter = pose;
  targetBox = getTarget;
  lastTarget = null;

  const measured = intakeCardQuad(id) ?? fallbackPileQuad(mediaType);
  fromQuad = measured;
  quad = measured;
  const c = quadCenter(measured);
  setInboxAnchor(c.x, c.y);

  heldId = id;
  emitCarry();
  paint();
  placeHand(0);
  return segment("lift", LIFT_MS);
}

/** Fly from the hand's current quad to the destination over `ms`. */
export function carryCard(ms: number): Promise<void> {
  if (mode === "idle") return Promise.resolve();
  fromQuad = quad;
  const to = targetQuad();
  const fc = quadCenter(fromQuad);
  const tc = quadCenter(to);
  arcLift = Math.min(44, Math.hypot(tc.x - fc.x, tc.y - fc.y) * 0.1);
  return segment("carry", ms);
}

/**
 * The tile exists now. Glide to where it actually landed if that differs,
 * wait for the wall card to mount, then hand off: ghost out, tile in, one
 * commit. Afterwards the hand keeps following the tile until `stopCarry()`.
 */
function abandoned(id: string) {
  return flightId !== id || mode === "idle";
}

export async function landCard(id: string): Promise<void> {
  if (abandoned(id)) return;
  const fallback = targetBox;
  targetBox = () => getLayout(id) ?? fallback();
  if (!getTile(id)) {
    // Placement failed; the card goes back to the pile.
    stopCarry();
    return;
  }
  const to = targetQuad();
  if (quadDelta(quad, to) > 1.5 && !prefersReducedMotion()) {
    fromQuad = quad;
    await segment("correct", CORRECT_MS);
  } else if (mode !== "hold") {
    mode = "hold";
    schedule();
  }
  if (abandoned(id)) return;

  await tileMounted(id);
  if (abandoned(id)) return;

  heldId = null;
  landingId = id;
  emitCarry();
  mode = "follow";
  schedule();
  window.setTimeout(() => {
    if (landingId === id) {
      landingId = null;
      emitCarry();
    }
  }, LANDING_MS);
}

/** Drop everything: ghost gone, hand free. Safe to call at any time. */
export function stopCarry() {
  clearSchedulers();
  mode = "idle";
  flightId = "";
  resolveSegment();
  if (heldId !== null) {
    heldId = null;
    emitCarry();
  }
}

export function isCarrying() {
  return mode !== "idle";
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fallbackPileQuad(mediaType?: MediaType): Quad {
  const box = tileBox(mediaType);
  const fit = intakeFit(mediaType);
  const w = box.w * fit;
  const h = box.h * fit;
  const base = intakeStack?.getBoundingClientRect();
  const left = base ? base.left : 28;
  const top = base ? base.top : 28;
  return rectQuad(left, top, w, h);
}

/** Resolves once the wall card for `id` is in the DOM and has had a frame. */
function tileMounted(id: string): Promise<void> {
  return new Promise((done) => {
    const deadline = performance.now() + MOUNT_TIMEOUT_MS;
    let settled = false;
    let handle = 0;
    let fallbackTimer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      cancelAnimationFrame(handle);
      clearTimeout(fallbackTimer);
      done();
    };
    const check = () => {
      if (settled) return;
      cancelAnimationFrame(handle);
      clearTimeout(fallbackTimer);
      if (getTileElement(id) || performance.now() > deadline || mode === "idle") {
        // One more frame so the (hidden) tile has been laid out before it shows.
        handle = requestAnimationFrame(finish);
        fallbackTimer = window.setTimeout(finish, 32);
        return;
      }
      handle = requestAnimationFrame(check);
      fallbackTimer = window.setTimeout(check, 32);
    };
    check();
  });
}
