
/**
 * The filing loop. For each pending clip:
 *
 *   reach  hand eases to the grip point on the front card of the pile
 *   grab   the pile card becomes the card in the hand (lib/carry.ts)
 *   carry  camera and card travel together to the packed destination
 *   place  place_tile; the wall tile takes over from the card in the hand
 *
 * All motion runs on its own clock and re-reads its target every frame, so
 * a user pan or zoom mid-step never makes anything jump.
 */
import {
  currentEaseDuration,
  easeCameraTo,
  getCamera,
  inboxScreen,
  msSinceUserCameraMove,
  worldBoxVisible,
} from "./camera";
import { SLOT_W } from "./constants";
import { carryCard, intakeGrip, landCard, pickUpCard, stopCarry, type Box } from "./carry";
import { easeHandToward } from "./hand";
import { getLayout, previewLayout } from "./layout";
import { tileBox, tileJitter, tileOrigin } from "./media";
import { parseSlot } from "./slots";
import {
  getClip,
  getTile,
  isParsing,
  peekPending,
  pendingCount,
  pickEmptySlot,
  promotePending,
  setCurating,
} from "./store";
import { callTool, pendingFromOccupancy } from "./tools";
import type { Clip, Occupancy } from "./types";

let running = false;
let organizeTimer = 0;
let lastTopic = "";
const PLACE_ZOOM = 0.72;
/** Carry never finishes faster than this, even if the camera has nothing to do. */
const CARRY_MIN_MS = 560;
/**
 * Any wheel/pan/zoom cancels a camera ease (the user is steering). Trackpad
 * momentum and pan inertia keep cancelling for a while after the gesture, so
 * the agent only takes the camera back once input has been quiet this long.
 */
const USER_QUIET_MS = 600;

function cameraNear(x: number, y: number) {
  const cam = getCamera();
  return Math.hypot(cam.x - x, cam.y - y) < SLOT_W / 2;
}

function asOccupancy(value: unknown): Occupancy {
  if (value && typeof value === "object" && "center" in value) {
    return value as Occupancy;
  }
  return { center: "0,0", empty: [], occupied: [], pending: 0, next: [] };
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function shortTitle(title: string) {
  return title.length > 36 ? `${title.slice(0, 35)}…` : title;
}

/** Prefer a different topic than the last drop so the hand travels between sections. */
function pickNextClip(ids: string[]): string | undefined {
  if (!ids.length) return undefined;
  const waiting = peekPending(12);
  const byId = new Map(waiting.map((clip) => [clip.id, clip]));
  const other = ids.filter((id) => byId.get(id)?.topic && byId.get(id)?.topic !== lastTopic);
  const pool = other.length ? other : ids;
  return pool[Math.floor(Math.random() * Math.min(pool.length, 5))] ?? ids[0];
}

/**
 * Let the page choose: it keeps each topic in its own section (see
 * store.pickEmptySlot). Computed up front so the hand carries the card to
 * the slot it will actually land on.
 */
function chooseSlot(topic: string): string | undefined {
  return pickEmptySlot(topic) ?? undefined;
}

function placedSlot(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const slot = (value as { slot?: unknown }).slot;
  return typeof slot === "string" ? slot : undefined;
}

function boxCenter(box: Box) {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

function boxOnScreen(box: Box) {
  return worldBoxVisible(box.x, box.y, box.x + box.w, box.y + box.h, 0);
}

/**
 * Where the card will be drawn: its packed position inside the topic
 * section. The grid slot is only the occupancy record; the camera and the
 * card in the hand both travel to the packed box.
 */
function destinationBox(clip: Clip, slot?: string): Box {
  const packed = previewLayout(clip.topic, clip.id, clip.mediaType);
  if (packed) return { x: packed.x, y: packed.y, w: packed.w, h: packed.h };
  if (slot) {
    const cell = parseSlot(slot);
    const o = tileOrigin(cell.col, cell.row, clip.mediaType);
    return { x: o.left, y: o.top, w: o.w, h: o.h };
  }
  const cam = getCamera();
  const size = tileBox(clip.mediaType);
  return { x: cam.x - size.w / 2, y: cam.y - size.h / 2, w: size.w, h: size.h };
}

async function step(frameIn: boolean): Promise<boolean> {
  const occupancy = asOccupancy(await callTool("get_occupancy"));
  const ids = pendingFromOccupancy(occupancy);
  if (ids.length === 0 && occupancy.pending === 0 && pendingCount() === 0) {
    return false;
  }
  const clipId = pickNextClip(ids);
  if (!clipId) return pendingCount() > 0;
  promotePending(clipId);
  const clip = getClip(clipId);
  if (!clip || getTile(clipId)) return pendingCount() > 0;
  const title = shortTitle(clip.title);
  const slotId = chooseSlot(clip.topic);
  const leanIn = frameIn && Math.abs(getCamera().zoom - PLACE_ZOOM) > 0.04 ? PLACE_ZOOM : undefined;
  const base = { id: clipId, title, tool: "place_tile" as const, slot: slotId };

  // REACH. The hand lets go of the last card and eases to the grip point on
  // the front card of the pile. The target is read live: the pile is still
  // settling after the promotion, and the hand should land on the card, not
  // on where the card used to be.
  stopCarry();
  if (leanIn !== undefined) {
    const cam = getCamera();
    void easeCameraTo(cam.x, cam.y, leanIn);
  }
  setCurating({ ...base, phase: "reach" });
  await easeHandToward(() => intakeGrip(clipId) ?? inboxScreen());
  if (getTile(clipId)) return pendingCount() > 0;

  // GRAB. The pile card is measured where it lies and becomes the card in
  // the hand: same face, same pixels, then a small lift.
  const dest = destinationBox(clip, slotId);
  setCurating({ ...base, phase: "grab" });
  await pickUpCard(clipId, () => dest, tileJitter(clipId), clip.mediaType);

  // CARRY. Camera and card travel together. The card runs on its own clock
  // toward a destination that is re-projected every frame, so a user pan
  // cancels the camera ease (its promise resolves early) but never the card.
  const drop = boxCenter(dest);
  const travel = easeCameraTo(drop.x, drop.y, leanIn);
  const carryMs = Math.max(CARRY_MIN_MS, currentEaseDuration());
  setCurating({ ...base, phase: "carry" });
  await Promise.all([travel, carryCard(carryMs)]);
  // The ride was cancelled by user input. If the user has since gone quiet,
  // finish the trip so the drop happens on screen; if they are still
  // steering, leave the camera alone and place anyway.
  if (!cameraNear(drop.x, drop.y) && msSinceUserCameraMove() > USER_QUIET_MS) {
    await easeCameraTo(drop.x, drop.y, leanIn);
  }

  // PLACE. The tile is created; the card in the hand glides to where it
  // actually landed (normally nowhere: preview and layout agree), then the
  // wall tile takes over in the same frame the hand opens.
  lastTopic = clip.topic;
  const placed = await callTool("place_tile", slotId ? { clipId, slotId } : { clipId });
  const slot = placedSlot(placed) ?? slotId;
  const landed = getLayout(clipId);
  if (landed && !boxOnScreen(landed) && msSinceUserCameraMove() > USER_QUIET_MS) {
    const c = boxCenter(landed);
    await easeCameraTo(c.x, c.y);
  }
  setCurating({ ...base, phase: "place", slot });
  await landCard(clipId);

  const more = pendingCount() > 0;
  // Only linger on the last drop. Otherwise the hand leaves immediately
  // so the next reach starts from here with no dead air.
  if (!more) await wait(160);
  return more;
}

async function loop() {
  running = true;
  lastTopic = "";
  try {
    let guard = 0;
    while (pendingCount() > 0 && guard < 400) {
      const more = await step(guard === 0);
      guard += 1;
      if (!more) break;
    }
  } finally {
    stopCarry();
    setCurating(null);
    running = false;
    if (pendingCount() > 0) kickAgent();
  }
}

export function kickAgent() {
  if (running) return;
  if (pendingCount() === 0) return;
  void loop();
}

export function scheduleOrganize() {
  window.clearTimeout(organizeTimer);
  organizeTimer = window.setTimeout(() => {
    if (isParsing()) {
      scheduleOrganize();
      return;
    }
    if (pendingCount() > 0) kickAgent();
  }, 700);
}
