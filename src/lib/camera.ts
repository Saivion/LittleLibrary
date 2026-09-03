
/**
 * Camera store (high-frequency interaction state).
 *
 * Performance notes:
 * - This module is deliberately NOT React state. Pan/zoom mutate module
 *   variables and schedule ONE requestAnimationFrame; listeners fire once per
 *   frame regardless of how many pointer/wheel events arrived in between.
 * - Listeners are cheap DOM writers (the world transform) and the derived
 *   visibility store. Nothing here triggers a React render on its own.
 * - Projection helpers mirror the CSS pipeline used by `.scene`/`.world`
 *   (perspective 1800px, perspective-origin 50% 48%, scale3d → rotateY →
 *   translate) so viewport culling is exact instead of a padded guess.
 */
import { PERSPECTIVE_PX, SLOT_H, SLOT_W, TILE_LIFT_PX, TILE_TILT_DEG, WALL_PITCH, WALL_YAW } from "./constants";
import type { Quad } from "./homography";
import { makeSlot, type Slot, type SlotId } from "./slots";

type Listener = () => void;

export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 2.5;

let camX = 0;
let camY = 0;
let zoom = 1;
let viewW = 1280;
let viewH = 800;

let version = 0;
let emittedVersion = 0;
let frameHandle = 0;
let easeHandle = 0;
let easeTimer = 0;
let easeFromX = 0;
let easeFromY = 0;
let easeFromZ = 1;
let easeToX = 0;
let easeToY = 0;
let easeToZ = 1;
let easeStart = 0;
let easeDuration = 0;
let easeResolve: (() => void) | null = null;
const frameListeners = new Set<Listener>();
const EASE_MIN_MS = 440;
const EASE_MAX_MS = 1450;
const EASE_BASE_MS = 340;
const EASE_MS_PER_PX = 0.4;

const YAW = (WALL_YAW * Math.PI) / 180;
const COS = Math.cos(YAW);
const SIN = Math.sin(YAW);
/** cos(wall yaw): horizontal foreshortening of the wall on screen. */
export const YAW_COS = COS;
/** Must match `perspective-origin` on `.scene` in globals.css. */
const ORIGIN_X = 0.5;
const ORIGIN_Y = 0.48;

function clearEaseSchedulers() {
  if (easeHandle) {
    cancelAnimationFrame(easeHandle);
    easeHandle = 0;
  }
  if (easeTimer) {
    clearTimeout(easeTimer);
    easeTimer = 0;
  }
}

function finishEase() {
  clearEaseSchedulers();
  easeDuration = 0;
  const done = easeResolve;
  easeResolve = null;
  done?.();
}

function stopEase() {
  if (!easeHandle && !easeTimer && !easeResolve) return;
  finishEase();
}

let lastUserMove = Number.NEGATIVE_INFINITY;
function noteUserMove() {
  lastUserMove = typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** ms since the user last panned/zoomed (wheel, drag, coast). Infinity if never. */
export function msSinceUserCameraMove() {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  return now - lastUserMove;
}

function scheduleEaseTick() {
  easeHandle = requestAnimationFrame(tickEase);
  easeTimer = window.setTimeout(() => tickEase(performance.now()), 32);
}

function easeInOutQuart(t: number) {
  return t < 0.5 ? 8 * t * t * t * t : 1 - (-2 * t + 2) ** 4 / 2;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function tickEase(now: number) {
  clearEaseSchedulers();
  const t = easeDuration <= 0 ? 1 : Math.min(1, (now - easeStart) / easeDuration);
  const e = easeInOutQuart(t);
  camX = easeFromX + (easeToX - easeFromX) * e;
  camY = easeFromY + (easeToY - easeFromY) * e;
  zoom = easeFromZ + (easeToZ - easeFromZ) * e;
  scheduleFrame();
  if (t >= 1) {
    camX = easeToX;
    camY = easeToY;
    zoom = easeToZ;
    finishEase();
    return;
  }
  scheduleEaseTick();
}

/**
 * Smoothly look at a point on the wall. Duration scales with distance so a
 * far slot is a pan, not a skip. Resolves when the ease finishes or a user
 * pan/zoom cancels it.
 */
export function easeCameraTo(worldX: number, worldY: number, nextZoom?: number): Promise<void> {
  easeFromX = camX;
  easeFromY = camY;
  easeFromZ = zoom;
  easeToX = worldX;
  easeToY = worldY;
  easeToZ = nextZoom === undefined ? zoom : clampZoom(nextZoom);
  const dist = Math.hypot(worldX - camX, worldY - camY);
  const zoomDelta = Math.abs(easeToZ - easeFromZ);
  if (prefersReducedMotion()) {
    camX = worldX;
    camY = worldY;
    zoom = easeToZ;
    scheduleFrame();
    finishEase();
    return Promise.resolve();
  }
  clearEaseSchedulers();
  easeStart = performance.now();
  easeDuration = Math.min(EASE_MAX_MS, Math.max(EASE_MIN_MS, EASE_BASE_MS + dist * EASE_MS_PER_PX));
  if (zoomDelta > 0.04) easeDuration = Math.max(easeDuration, 560);
  return new Promise((resolve) => {
    const prev = easeResolve;
    easeResolve = resolve;
    prev?.();
    scheduleEaseTick();
  });
}

/** Duration (ms) of the ease started by the most recent easeCameraTo; 0 if none. */
export function currentEaseDuration() {
  return easeDuration;
}

/** Eased 0–1 while a scripted ease is running; 1 when idle or arrived. */
export function cameraEaseProgress() {
  if (easeDuration <= 0) return 1;
  return easeInOutQuart(Math.min(1, (performance.now() - easeStart) / easeDuration));
}

function scheduleFrame() {
  version += 1;
  if (frameHandle) return;
  if (typeof requestAnimationFrame !== "function") {
    flushCamera();
    return;
  }
  frameHandle = requestAnimationFrame(() => {
    frameHandle = 0;
    flushCamera();
  });
}

/** Deliver pending camera changes to listeners now (used by rAF and tests). */
export function flushCamera() {
  if (frameHandle) {
    cancelAnimationFrame(frameHandle);
    frameHandle = 0;
  }
  if (emittedVersion === version) return;
  emittedVersion = version;
  for (const listener of frameListeners) listener();
}

export function subscribeCamera(listener: Listener) {
  frameListeners.add(listener);
  return () => {
    frameListeners.delete(listener);
  };
}

export function getCamera() {
  return { x: camX, y: camY, zoom, viewW, viewH };
}

export function getCameraVersion() {
  return version;
}

export function cameraSlot(): Slot {
  return {
    col: Math.round(camX / SLOT_W),
    row: Math.round(camY / SLOT_H),
  };
}

export function cameraSlotId() {
  const s = cameraSlot();
  return makeSlot(s.col, s.row);
}

export function setCamera(x: number, y: number) {
  stopEase();
  camX = x;
  camY = y;
  scheduleFrame();
}

export function panBy(screenDx: number, screenDy: number) {
  stopEase();
  noteUserMove();
  camX -= screenDx / zoom;
  camY -= screenDy / zoom;
  scheduleFrame();
}

export function panWheel(deltaX: number, deltaY: number) {
  stopEase();
  noteUserMove();
  camX += deltaX / zoom;
  camY += deltaY / zoom;
  scheduleFrame();
}

function clampZoom(value: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/** Zoom about a screen point so the wall under the cursor stays put. */
export function zoomAt(screenX: number, screenY: number, factor: number) {
  stopEase();
  noteUserMove();
  const next = clampZoom(zoom * factor);
  if (next === zoom) return;
  const cx = viewW / 2;
  const cy = viewH / 2;
  // First-order anchor (ignores perspective curvature; good enough for input).
  camX += ((screenX - cx) / COS) * (1 / zoom - 1 / next);
  camY += (screenY - cy) * (1 / zoom - 1 / next);
  zoom = next;
  scheduleFrame();
}

export function setZoom(value: number) {
  stopEase();
  const next = clampZoom(value);
  if (next === zoom) return;
  zoom = next;
  scheduleFrame();
}

export function setViewportSize(width: number, height: number) {
  if (width === viewW && height === viewH) return;
  viewW = width;
  viewH = height;
  scheduleFrame();
}

/** Compositor-only: scale3d + rotate + translate3d, never top/left. */
export function worldTransform() {
  return `scale3d(${zoom}, ${zoom}, ${zoom}) rotateY(${WALL_YAW}deg) rotateX(${WALL_PITCH}deg) translate3d(${-camX}px, ${-camY}px, 0px)`;
}

/** Where the intake pile sits on screen (centre of the front card). */
let inboxX = 82;
let inboxY = 94;

/** The pile measures itself and reports here, so deal-in flights start on it. */
export function setInboxAnchor(x: number, y: number) {
  if (Number.isFinite(x) && Number.isFinite(y)) {
    inboxX = x;
    inboxY = y;
  }
}

export function inboxScreen() {
  return { x: inboxX, y: inboxY };
}

/**
 * Project a point on the wall plane (world px) to screen px, reproducing the
 * CSS perspective/rotate pipeline. `k` is the perspective scale factor.
 */
export function projectWorld(worldX: number, worldY: number) {
  const x = worldX - camX;
  const y = worldY - camY;
  const px = x * COS * zoom;
  const py = y * zoom;
  const pz = -x * SIN * zoom;
  const ox = viewW * ORIGIN_X;
  const oy = viewH * ORIGIN_Y;
  const sx = viewW / 2 + px;
  const sy = viewH / 2 + py;
  const denom = PERSPECTIVE_PX - pz;
  // Points at/behind the eye: treat as "covers everything" (conservative).
  const k = denom <= 1 ? Number.POSITIVE_INFINITY : PERSPECTIVE_PX / denom;
  return { x: ox + (sx - ox) * k, y: oy + (sy - oy) * k, k };
}

/**
 * Same pipeline for a point above the wall plane (world px, z toward the
 * viewer). Cards sit at translateZ(24px) with their own rotateY, so
 * projecting their corners needs the full 3D path, not the planar shortcut.
 */
export function projectWorld3(worldX: number, worldY: number, worldZ: number) {
  const x = worldX - camX;
  const y = worldY - camY;
  const px = (x * COS + worldZ * SIN) * zoom;
  const py = y * zoom;
  const pz = (-x * SIN + worldZ * COS) * zoom;
  const ox = viewW * ORIGIN_X;
  const oy = viewH * ORIGIN_Y;
  const sx = viewW / 2 + px;
  const sy = viewH / 2 + py;
  const denom = PERSPECTIVE_PX - pz;
  const k = denom <= 1 ? Number.POSITIVE_INFINITY : PERSPECTIVE_PX / denom;
  return { x: ox + (sx - ox) * k, y: oy + (sy - oy) * k, k };
}

const TILT = (TILE_TILT_DEG * Math.PI) / 180;
const TILT_COS = Math.cos(TILT);
const TILT_SIN = Math.sin(TILT);

/**
 * Screen quad (tl, tr, br, bl) of a card drawn at world box `box` with the
 * wall card pose from globals.css:
 *   translate3d(x + jx, y + jy, 0) rotateY(-8deg) translateZ(24px) rotate(rot)
 * about the card centre, then the world transform and perspective. This is
 * exactly what `.tile-card` renders, so a screen-space copy mapped onto the
 * quad coincides with the wall card. Null if any corner is behind the eye.
 */
export function tileScreenQuad(
  box: { x: number; y: number; w: number; h: number },
  jitter: { jx: number; jy: number; rot: number },
): Quad | null {
  const cx = box.x + jitter.jx + box.w / 2;
  const cy = box.y + jitter.jy + box.h / 2;
  const r = (jitter.rot * Math.PI) / 180;
  const cr = Math.cos(r);
  const sr = Math.sin(r);
  const hw = box.w / 2;
  const hh = box.h / 2;
  const out: { x: number; y: number }[] = [];
  const corners = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  for (const [u, v] of corners) {
    // rotate(rot) in the card plane
    const x1 = u * cr - v * sr;
    const y1 = u * sr + v * cr;
    // translateZ(lift), then rotateY(tilt)
    const z1 = TILE_LIFT_PX;
    const x2 = x1 * TILT_COS + z1 * TILT_SIN;
    const z2 = -x1 * TILT_SIN + z1 * TILT_COS;
    const p = projectWorld3(cx + x2, cy + y1, z2);
    if (!Number.isFinite(p.k) || p.k <= 0) return null;
    out.push({ x: p.x, y: p.y });
  }
  return [out[0], out[1], out[2], out[3]];
}

export function slotToScreen(slot: Slot) {
  const p = projectWorld(slot.col * SLOT_W + SLOT_W / 2, slot.row * SLOT_H + SLOT_H / 2);
  return { x: p.x, y: p.y };
}

/** Screen-space bounding box of a slot cell (superset of the projected quad). */
export function slotScreenBox(col: number, row: number) {
  const x0 = col * SLOT_W;
  const y0 = row * SLOT_H;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let behind = false;
  for (let i = 0; i < 4; i++) {
    const p = projectWorld(i & 1 ? x0 + SLOT_W : x0, i & 2 ? y0 + SLOT_H : y0);
    if (!Number.isFinite(p.k)) {
      behind = true;
      break;
    }
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, behind };
}

/**
 * Is a world-space box (e.g. a packed card) on screen? Same exact projection
 * as slot culling, so what the wall draws and what is mounted agree.
 */
export function worldBoxVisible(x0: number, y0: number, x1: number, y1: number, marginPx = 0): boolean {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < 4; i++) {
    const p = projectWorld(i & 1 ? x1 : x0, i & 2 ? y1 : y0);
    if (!Number.isFinite(p.k)) return true;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return maxX >= -marginPx && minX <= viewW + marginPx && maxY >= -marginPx && minY <= viewH + marginPx;
}

export function slotVisible(col: number, row: number, marginPx = 0): boolean {
  const box = slotScreenBox(col, row);
  if (box.behind) return true;
  return (
    box.maxX >= -marginPx &&
    box.minX <= viewW + marginPx &&
    box.maxY >= -marginPx &&
    box.minY <= viewH + marginPx
  );
}

export function slotInViewport(slot: Slot): boolean {
  return slotVisible(slot.col, slot.row, 0);
}

/** Half a slot of screen slack so tiles are mounted just before they enter. */
export const CULL_MARGIN_PX = Math.round(SLOT_W * 0.5);

let cachedSlots: readonly Slot[] = [];
let cachedIds: readonly SlotId[] = [];
let cacheX = Number.NaN;
let cacheY = Number.NaN;
let cacheZoom = Number.NaN;
let cacheW = Number.NaN;
let cacheH = Number.NaN;
/** Recompute only after the camera moved a quarter slot (margin covers the rest). */
const RECOMPUTE_DX = SLOT_W / 4;
const RECOMPUTE_DY = SLOT_H / 4;

/**
 * Spatial query: which grid cells could be on screen right now. Candidates
 * come from a generous analytic range, then each cell is tested exactly via
 * projection. Result identity is stable until the camera moves enough to
 * matter, so subscribers can skip work by reference comparison.
 */
export function visibleSlots(): readonly Slot[] {
  if (
    Math.abs(camX - cacheX) < RECOMPUTE_DX &&
    Math.abs(camY - cacheY) < RECOMPUTE_DY &&
    zoom === cacheZoom &&
    viewW === cacheW &&
    viewH === cacheH
  ) {
    return cachedSlots;
  }
  cacheX = camX;
  cacheY = camY;
  cacheZoom = zoom;
  cacheW = viewW;
  cacheH = viewH;

  const center = cameraSlot();
  // Far side of the yawed wall shrinks to ~0.55x; near side grows to ~1.6x.
  const halfCols = Math.ceil(((viewW / 2) / (SLOT_W * COS * zoom)) * 1.9) + 2;
  const halfRows = Math.ceil(((viewH / 2) / (SLOT_H * zoom)) * 1.9) + 2;
  const slots: Slot[] = [];
  const ids: SlotId[] = [];
  const margin = CULL_MARGIN_PX + RECOMPUTE_DX * zoom;
  for (let row = center.row - halfRows; row <= center.row + halfRows; row++) {
    for (let col = center.col - halfCols; col <= center.col + halfCols; col++) {
      if (!slotVisible(col, row, margin)) continue;
      slots.push({ col, row });
      ids.push(makeSlot(col, row));
    }
  }
  cachedSlots = slots;
  cachedIds = ids;
  return slots;
}

export function visibleSlotIds(): readonly SlotId[] {
  visibleSlots();
  return cachedIds;
}

/** World-space offset from a tile to the inbox, for the deal-in animation. */
export function inboxFromDelta(tileLeft: number, tileTop: number) {
  return {
    x: camX + (inboxX - viewW / 2) / zoom - tileLeft,
    y: camY + (inboxY - viewH / 2) / zoom - tileTop,
  };
}
