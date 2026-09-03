
/**
 * Derived store: which tiles React should have mounted right now.
 *
 *   camera frame ──┐
 *   document emit ─┼─▶ recompute ─▶ (unchanged? keep same array) ─▶ notify
 *   agent / ui ────┘
 *
 * Query path is  viewport → visible grid cells (camera) → layout cell index
 * (packed boxes, lib/layout.ts) → entries, with the occupancy slot as a
 * fallback for tiles that have no packed box yet. Cost is O(cells on
 * screen), never O(tiles in document). Cards are DRAWN at packed positions,
 * so culling must ask the layout, not the occupancy grid, or cards pop in
 * and out at the wrong moment.
 * Tiles being placed, open in the inspector, dragged, or selected are pinned
 * so they stay mounted (and interactive) even if they scroll out of view.
 *
 * Each entry also carries a depth: 0 when the drawn card intersects the
 * window (full card), 1 when it is mounted but off screen (margin/pinned/
 * section), so the card can skip its body and links can ignore it. Depth is
 * per-frame exact, so a card never shows hollow while it is actually in view.
 */
import { slotVisible, subscribeCamera, visibleSlotIds, worldBoxVisible } from "./camera";
import { getLayout, tileIdsInCell } from "./layout";
import { parseSlot } from "./slots";
import { getCurating, getTile, subscribeAgent, subscribeDoc, tileIdAt, tileIdsForTopic } from "./store";
import { getDragIds, getOpenId, getSelection, subscribeDrag, subscribeSelection, subscribeUi } from "./ui";

type Listener = () => void;

export type VisibleEntry = { id: string; depth: 0 | 1 };

const EMPTY: readonly VisibleEntry[] = [];
let entries: readonly VisibleEntry[] = EMPTY;
let version = 0;
const cache = new Map<string, VisibleEntry>();
const listeners = new Set<Listener>();
let started = false;

function entryFor(id: string, depth: 0 | 1): VisibleEntry {
  const prev = cache.get(id);
  if (prev && prev.depth === depth) return prev;
  const next = { id, depth };
  cache.set(id, next);
  return next;
}

/**
 * Detail level is decided by whether the DRAWN card (its packed box, or the
 * slot cell if it has none) intersects the window, not by distance from the
 * camera centre. Anything on screen, even partially, gets its full content;
 * depth 1 is reserved for cards mounted only via the cull margin, a pin or
 * their section, so their body can be skipped without a hollow card ever
 * being visible.
 */
function depthFor(id: string): 0 | 1 {
  const box = getLayout(id);
  if (box) return worldBoxVisible(box.x, box.y, box.x + box.w, box.y + box.h, 0) ? 0 : 1;
  const tile = getTile(id);
  if (!tile) return 1;
  const slot = parseSlot(tile.slot);
  return slotVisible(slot.col, slot.row, 0) ? 0 : 1;
}

function recompute() {
  const next: VisibleEntry[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    next.push(entryFor(id, depthFor(id)));
  };
  for (const slotId of visibleSlotIds()) {
    // Cards drawn in this cell (packed layout) …
    for (const id of tileIdsInCell(slotId)) add(id);
    // … plus the occupant of the cell, for tiles without a box yet.
    const id = tileIdAt(slotId);
    if (id) add(id);
  }
  // Pinned: stay mounted even off-screen (being placed, open, dragged, selected).
  const pin = (id: string | undefined | null) => {
    if (!id) return;
    if (!getTile(id)) return;
    add(id);
  };
  pin(getCurating()?.id);
  pin(getOpenId());
  for (const id of getDragIds()) pin(id);
  for (const id of getSelection()) pin(id);

  // A packed cluster lives around the topic home, so once any card is in
  // view, mount the rest of that section.
  const topics = new Set<string>();
  for (const id of seen) {
    const tile = getTile(id);
    if (tile) topics.add(tile.topic);
  }
  for (const topic of topics) {
    for (const id of tileIdsForTopic(topic)) pin(id);
  }

  let same = next.length === entries.length;
  if (same) {
    for (let i = 0; i < next.length; i++) {
      if (next[i] !== entries[i]) {
        same = false;
        break;
      }
    }
  }
  if (same) return;
  // Drop cache entries for tiles that left the viewport (bounded memory).
  if (cache.size > next.length * 2 + 64) {
    for (const id of cache.keys()) if (!seen.has(id)) cache.delete(id);
  }
  entries = next;
  version += 1;
  for (const listener of listeners) listener();
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  subscribeCamera(recompute);
  subscribeDoc(recompute);
  subscribeAgent(recompute);
  subscribeUi(recompute);
  subscribeDrag(recompute);
  subscribeSelection(recompute);
  recompute();
}

export function subscribeVisible(listener: Listener) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getVisibleEntries() {
  return entries;
}

export function getServerVisibleEntries() {
  return EMPTY;
}

export function getVisibleVersion() {
  return version;
}
