
/**
 * Visual positions for cards: packed around each topic home, not on the
 * occupancy grid. Slots stay for the agent; this store is what the wall draws.
 */
import { SLOT_H, SLOT_W } from "./constants";
import { tileBox } from "./media";
import { packAround, type PackedBox } from "./pack";
import { makeSlot, type SlotId } from "./slots";
import { allTiles, getDocVersion, getTile, subscribeDoc, tileIdsForTopic, topicHomeSlot } from "./store";
import type { MediaType } from "./types";

type Listener = () => void;

const EMPTY_BOX: PackedBox = { id: "", x: 0, y: 0, w: 180, h: 220 };
const boxes = new Map<string, PackedBox>();
const byTopicBoxes = new Map<string, PackedBox[]>();
/**
 * Packed positions that have been committed, per topic, in arrival order.
 * A card is packed once, when it first appears, around the cards already
 * there; it never moves because a later card arrived. This is what makes
 * the agent's drop crisp (no neighbours sliding) and keeps `previewLayout`
 * honest: the preview for a new card is exactly where it will land.
 */
const committed = new Map<string, PackedBox[]>();
/** Grid cell → ids of tiles whose packed box overlaps that cell (spatial index for culling). */
const byCell = new Map<SlotId, string[]>();
const NO_IDS: readonly string[] = [];

function indexCells(box: PackedBox, into: Map<SlotId, string[]>) {
  const c0 = Math.floor(box.x / SLOT_W);
  const c1 = Math.floor((box.x + box.w) / SLOT_W);
  const r0 = Math.floor(box.y / SLOT_H);
  const r1 = Math.floor((box.y + box.h) / SLOT_H);
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const key = makeSlot(col, row);
      const list = into.get(key);
      if (list) list.push(box.id);
      else into.set(key, [box.id]);
    }
  }
}
const listeners = new Set<Listener>();
const idListeners = new Map<string, Set<Listener>>();
let started = false;
let dirty = true;
let version = 0;
let builtDocVersion = -1;

function topicCenter(topic: string) {
  const home = topicHomeSlot(topic);
  return {
    x: home.col * SLOT_W + SLOT_W / 2,
    y: home.row * SLOT_H + SLOT_H / 2,
  };
}

/**
 * Committed boxes for a topic, pruned to tiles that still exist, plus any
 * tiles of the topic that have not been packed yet (in id order, which is
 * arrival order). Returns the committed list (arrival order). Never moves a
 * box that is already committed.
 */
function commitTopic(topic: string): PackedBox[] {
  const ids = tileIdsForTopic(topic);
  const prev = committed.get(topic) ?? [];
  const kept = prev.filter((box) => ids.has(box.id));
  const have = new Set(kept.map((box) => box.id));
  const fresh: { id: string; w: number; h: number }[] = [];
  for (const id of ids) {
    if (have.has(id)) continue;
    const tile = getTile(id);
    if (!tile) continue;
    const box = tileBox(tile.mediaType);
    fresh.push({ id, w: box.w, h: box.h });
  }
  let list = kept;
  if (fresh.length) {
    const origin = topicCenter(topic);
    list = kept.concat(packAround(fresh, origin.x, origin.y, kept));
  }
  if (list !== prev || list.length !== prev.length) committed.set(topic, list);
  if (!list.length) committed.delete(topic);
  return list;
}

/** Drawn boxes for a topic: committed positions, hand-placed cards where they were dropped. */
function drawnBoxes(list: readonly PackedBox[]): PackedBox[] {
  return list.map((box) => {
    const pos = getTile(box.id)?.pos;
    return pos ? { ...box, x: pos.x, y: pos.y } : { ...box };
  });
}

function packTopic(topic: string) {
  return drawnBoxes(commitTopic(topic));
}

function rebuild() {
  const next = new Map<string, PackedBox>();
  const grouped = new Map<string, PackedBox[]>();
  const topics = new Set<string>();
  for (const tile of allTiles()) topics.add(tile.topic);

  for (const topic of topics) {
    const packed = packTopic(topic);
    grouped.set(topic, packed);
    for (const box of packed) next.set(box.id, box);
  }
  boxes.clear();
  for (const [id, box] of next) boxes.set(id, box);
  byTopicBoxes.clear();
  for (const [topic, list] of grouped) byTopicBoxes.set(topic, list);
  for (const topic of Array.from(committed.keys())) {
    if (!topics.has(topic)) committed.delete(topic);
  }
  byCell.clear();
  for (const box of next.values()) indexCells(box, byCell);
  version += 1;
}

function stale() {
  if (dirty) return true;
  // A move keeps the id set but changes positions; the doc version catches it
  // regardless of which derived store asks first after the emit.
  if (getDocVersion() !== builtDocVersion) return true;
  const tiles = allTiles();
  if (tiles.length !== boxes.size) return true;
  for (const tile of tiles) if (!boxes.has(tile.id)) return true;
  return false;
}

function ensure() {
  start();
  if (!stale()) return;
  dirty = false;
  builtDocVersion = getDocVersion();
  rebuild();
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  subscribeDoc(() => {
    dirty = true;
    ensure();
    for (const listener of listeners) listener();
    for (const group of idListeners.values()) {
      for (const listener of group) listener();
    }
  });
}

export function subscribeLayout(listener: Listener) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeLayoutId(id: string, listener: Listener) {
  start();
  let group = idListeners.get(id);
  if (!group) {
    group = new Set();
    idListeners.set(id, group);
  }
  group.add(listener);
  return () => {
    group?.delete(listener);
    if (group && group.size === 0) idListeners.delete(id);
  };
}

export function getLayout(id: string): PackedBox | undefined {
  ensure();
  let box = boxes.get(id);
  if (box) return box;
  const tile = getTile(id);
  if (!tile) return undefined;
  dirty = true;
  ensure();
  box = boxes.get(id);
  return box;
}

/** Ids of tiles drawn (at least partly) inside a grid cell. */
export function tileIdsInCell(slotId: SlotId): readonly string[] {
  ensure();
  return byCell.get(slotId) ?? NO_IDS;
}

export function getLayoutCenter(id: string) {
  const box = getLayout(id);
  if (!box) return null;
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

export function getTopicBoxes(topic: string): readonly PackedBox[] {
  ensure();
  return byTopicBoxes.get(topic) ?? [];
}

/**
 * Where a card that is not on the wall yet will be drawn if it joins
 * `topic` now: packed around the committed boxes exactly as `commitTopic`
 * will do when it lands, so the agent carries it to its real destination.
 */
export function previewLayout(
  topic: string,
  id: string,
  mediaType?: MediaType,
): PackedBox | undefined {
  ensure();
  const existing = boxes.get(id);
  if (existing) return existing;
  const current = commitTopic(topic);
  const size = tileBox(mediaType);
  const origin = topicCenter(topic);
  return packAround([{ id, w: size.w, h: size.h }], origin.x, origin.y, current)[0];
}

export function getLayoutVersion() {
  ensure();
  return version;
}

export function getServerLayout(_id: string): PackedBox | undefined {
  return undefined;
}

export { EMPTY_BOX };
