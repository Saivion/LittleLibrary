
/**
 * Document store.
 *
 * Architecture (see PERFORMANCE.md):
 * - Three independent slices with their own subscriptions so a change in one
 *   never re-renders consumers of another:
 *     document  → tiles, occupancy grid (also the spatial index), topic index
 *     intake    → staged clips, pending count, parsing flag
 *     agent     → the "curating" animation state
 * - Per-tile listeners: a tile move notifies only that tile's subscribers.
 * - Snapshots are only rebuilt for the slice that changed; the document slice
 *   never materialises an array of all tiles on emit.
 * - `transact()` batches any number of mutations into one emit per slice.
 */
import { cameraSlot, slotInViewport, visibleSlotIds } from "./camera";
import { OCCUPANCY_CHAR_CAP } from "./constants";
import {
  isSlotId,
  makeSlot,
  nearestEmpty,
  nearestEmptyOnWall,
  parseSlot,
  slotCentroid,
  slotManhattan,
  spiral,
  type Slot,
  type SlotId,
} from "./slots";
import type { Clip, Curating, Occupancy, OccupiedView, Tile } from "./types";

type Listener = () => void;

let seq = 1;
const clips = new Map<string, Clip>();
const pending: string[] = [];
const tiles = new Map<string, Tile>();
/** slot id → tile id. Doubles as the grid spatial index for viewport queries. */
const occupancy = new Map<SlotId, string>();
/** topic → tile ids, so topic-aware placement never scans every tile. */
const byTopic = new Map<string, Set<string>>();
let parsing = 0;
let curating: Curating | null = null;
/** id → placement time; only recently placed tiles play the deal-in. */
const placedAt = new Map<string, number>();
const DEAL_WINDOW_MS = 4000;

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

let txDepth = 0;
let txDoc: Set<string> | null = null;
let txIntake = false;
let txAgent = false;

/** Run several mutations with a single emit per touched slice. */
export function transact<T>(fn: () => T): T {
  txDepth += 1;
  try {
    return fn();
  } finally {
    txDepth -= 1;
    if (txDepth === 0) flushTx();
  }
}

function flushTx() {
  const doc = txDoc;
  const intake = txIntake;
  const agent = txAgent;
  txDoc = null;
  txIntake = false;
  txAgent = false;
  if (doc) emitDocNow(doc);
  if (intake) emitIntakeNow();
  if (agent) emitAgentNow();
}

/* ------------------------------------------------------------------ */
/* Document slice                                                      */
/* ------------------------------------------------------------------ */

let docVersion = 0;
const docListeners = new Set<Listener>();
const tileListeners = new Map<string, Set<Listener>>();

function emitDoc(changed: Iterable<string>) {
  if (txDepth > 0) {
    txDoc ??= new Set();
    for (const id of changed) txDoc.add(id);
    return;
  }
  emitDocNow(changed);
}

function emitDocNow(changed: Iterable<string>) {
  docVersion += 1;
  for (const id of changed) {
    const set = tileListeners.get(id);
    if (!set) continue;
    for (const listener of set) listener();
  }
  for (const listener of docListeners) listener();
}

export function subscribeDoc(listener: Listener) {
  docListeners.add(listener);
  return () => {
    docListeners.delete(listener);
  };
}

export function subscribeTile(id: string, listener: Listener) {
  let set = tileListeners.get(id);
  if (!set) {
    set = new Set();
    tileListeners.set(id, set);
  }
  set.add(listener);
  return () => {
    const current = tileListeners.get(id);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) tileListeners.delete(id);
  };
}

export function getDocVersion() {
  return docVersion;
}

export function getTile(id: string) {
  return tiles.get(id);
}

export function tileCount() {
  return tiles.size;
}

export function allTiles() {
  return Array.from(tiles.values());
}

export function occupiedSet() {
  return new Set(occupancy.keys());
}

export function tileAt(slot: SlotId) {
  const id = occupancy.get(slot);
  return id ? tiles.get(id) : undefined;
}

const NO_IDS: ReadonlySet<string> = new Set();

/** Ids of every tile with this topic (live set; do not mutate). */
export function tileIdsForTopic(topic: string): ReadonlySet<string> {
  return byTopic.get(topic) ?? NO_IDS;
}

export function tileIdAt(slot: SlotId) {
  return occupancy.get(slot);
}

/**
 * Whether a card mounting now should play the fly-in from the inbox. True only
 * for tiles the agent placed moments ago; tiles that merely scroll into view
 * (or were bulk-inserted) mount in place, which keeps panning across a large
 * wall free of hundreds of transform animations.
 */
export function recentlyPlaced(id: string) {
  const at = placedAt.get(id);
  if (at === undefined) return false;
  if (Date.now() - at > DEAL_WINDOW_MS) {
    placedAt.delete(id);
    return false;
  }
  return true;
}

function indexTopic(tile: Tile) {
  let set = byTopic.get(tile.topic);
  if (!set) {
    set = new Set();
    byTopic.set(tile.topic, set);
  }
  set.add(tile.id);
}

/* ------------------------------------------------------------------ */
/* Intake slice                                                        */
/* ------------------------------------------------------------------ */

export type IntakeSnapshot = {
  version: number;
  staged: Clip[];
  pending: number;
  parsing: boolean;
};

let intakeVersion = 0;
const intakeListeners = new Set<Listener>();
let intakeSnapshot: IntakeSnapshot = { version: 0, staged: [], pending: 0, parsing: false };
const INTAKE_SERVER: IntakeSnapshot = intakeSnapshot;

function emitIntake() {
  if (txDepth > 0) {
    txIntake = true;
    return;
  }
  emitIntakeNow();
}

function emitIntakeNow() {
  intakeVersion += 1;
  const staged: Clip[] = [];
  for (const id of pending) {
    const clip = clips.get(id);
    if (clip) staged.push(clip);
  }
  intakeSnapshot = {
    version: intakeVersion,
    staged,
    pending: pending.length,
    parsing: parsing > 0,
  };
  for (const listener of intakeListeners) listener();
}

export function subscribeIntake(listener: Listener) {
  intakeListeners.add(listener);
  return () => {
    intakeListeners.delete(listener);
  };
}

export function getIntakeSnapshot() {
  return intakeSnapshot;
}

export function getIntakeServerSnapshot() {
  return INTAKE_SERVER;
}

/* ------------------------------------------------------------------ */
/* Agent slice                                                         */
/* ------------------------------------------------------------------ */

const agentListeners = new Set<Listener>();

function emitAgentNow() {
  for (const listener of agentListeners) listener();
}

export function subscribeAgent(listener: Listener) {
  agentListeners.add(listener);
  return () => {
    agentListeners.delete(listener);
  };
}

export function getCurating() {
  return curating;
}

export function getServerCurating(): Curating | null {
  return null;
}

export function setCurating(next: Curating | null) {
  curating = next;
  if (txDepth > 0) {
    txAgent = true;
    return;
  }
  emitAgentNow();
}

/* ------------------------------------------------------------------ */
/* Clips / pending                                                     */
/* ------------------------------------------------------------------ */

export function nextClipId() {
  const id = `c${seq}`;
  seq += 1;
  return id;
}

export function beginParse() {
  parsing += 1;
  emitIntake();
}

export function endParse() {
  parsing = Math.max(0, parsing - 1);
  emitIntake();
}

export function enqueueClip(clip: Clip) {
  clips.set(clip.id, clip);
  pending.push(clip.id);
  emitIntake();
}

/** Bulk intake: one emit for the whole batch. */
export function enqueueClips(batch: Clip[]) {
  if (!batch.length) return;
  for (const clip of batch) {
    clips.set(clip.id, clip);
    pending.push(clip.id);
  }
  emitIntake();
}

/**
 * Attach a preview that finished AFTER the clip was registered (deferred PDF
 * poster / video poster). Notifies only the affected tile (if placed) and the
 * intake slice (if still pending).
 */
export function setClipImage(id: string, imageUrl: string) {
  const clip = clips.get(id);
  if (!clip) return;
  if (clip.imageUrl === imageUrl) return;
  clips.set(id, { ...clip, imageUrl });
  const tile = tiles.get(id);
  transact(() => {
    if (tile) {
      tiles.set(id, { ...tile, imageUrl });
      emitDoc([id]);
    }
    if (pending.includes(id)) emitIntake();
  });
}

export function peekPending(limit: number): Clip[] {
  const out: Clip[] = [];
  for (const id of pending) {
    const clip = clips.get(id);
    if (clip) out.push(clip);
    if (out.length >= limit) break;
  }
  return out;
}

/** Move a pending clip to the front of the pile so the agent can pick it. */
export function promotePending(id: string) {
  const index = pending.indexOf(id);
  if (index <= 0) return;
  pending.splice(index, 1);
  pending.unshift(id);
  emitIntake();
}

export function pendingCount() {
  return pending.length;
}

export function isParsing() {
  return parsing > 0;
}

export function getClip(id: string) {
  return clips.get(id);
}

/* ------------------------------------------------------------------ */
/* Occupancy (agent-facing view of the wall)                           */
/* ------------------------------------------------------------------ */

function shorten(text: string, n: number) {
  return text.length <= n ? text : `${text.slice(0, n - 1)}…`;
}

export function buildOccupancy(): Occupancy {
  const center = cameraSlot();
  const centerId = makeSlot(center.col, center.row);
  const empty: SlotId[] = [];
  const occupied: OccupiedView[] = [];

  const vis = viewportWindow(center);
  const visIds = new Set(vis.map((slot) => makeSlot(slot.col, slot.row)));
  for (const id of visIds) {
    const tileId = occupancy.get(id);
    if (!tileId) continue;
    const tile = tiles.get(tileId);
    if (tile) {
      occupied.push({
        id: tile.id,
        slot: tile.slot,
        topic: tile.topic,
        title: shorten(tile.title, 36),
      });
    }
  }
  for (const cell of spiral(center)) {
    if (slotManhattan(cell, center) > 12) break;
    const id = makeSlot(cell.col, cell.row);
    if (!visIds.has(id) || occupancy.has(id)) continue;
    empty.push(id);
    if (empty.length >= 48) break;
  }

  const next = peekPending(8).map((clip) => ({
    id: clip.id,
    topic: clip.topic,
    title: shorten(clip.title, 28),
  }));

  const payload: Occupancy = {
    center: centerId,
    empty,
    occupied,
    pending: pending.length,
    next,
  };

  shrinkToCap(payload);
  return payload;
}

function viewportWindow(center: Slot): Slot[] {
  const halfCols = 6;
  const halfRows = 4;
  const out: Slot[] = [];
  for (let col = center.col - halfCols; col <= center.col + halfCols; col++) {
    for (let row = center.row - halfRows; row <= center.row + halfRows; row++) {
      out.push({ col, row });
    }
  }
  return out;
}

function shrinkToCap(payload: Occupancy) {
  let json = JSON.stringify(payload);
  while (json.length > OCCUPANCY_CHAR_CAP) {
    if (payload.empty.length > 6) {
      payload.empty.pop();
    } else if (payload.next.length > 1) {
      payload.next.pop();
    } else if (payload.occupied.length > 0) {
      const last = payload.occupied[payload.occupied.length - 1];
      if (last.title.length > 10) last.title = shorten(last.title, 10);
      else payload.occupied.pop();
    } else if (payload.empty.length > 0) {
      payload.empty.pop();
    } else {
      break;
    }
    json = JSON.stringify(payload);
  }
}

/* ------------------------------------------------------------------ */
/* Placement                                                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Section layout                                                      */
/*                                                                     */
/* Each topic owns a home on a stable 3-column grid anchored the first */
/* time a section is placed. Later topics take the next cell — they do */
/* not chase the camera — so clusters read as a pinboard, not a drift. */
/* Cards spiral around their home and never touch another topic.       */
/* ------------------------------------------------------------------ */

const topicHome = new Map<string, Slot>();
let boardOrigin: Slot | null = null;
const HOME_STRIDE_C = 5;
const HOME_STRIDE_R = 4;
const HOME_GRID_COLS = 3;
const SECTION_SEARCH_RADIUS = 40;

const SAMPLE_HOME_GRID = [
  ["weather", 0, 0],
  ["meeting", 1, 0],
  ["invoice", 2, 0],
  ["recipe", 0, 1],
  ["travel", 1, 1],
  ["images", 2, 1],
] as const;

function topicAt(col: number, row: number) {
  const id = occupancy.get(makeSlot(col, row));
  return id ? tiles.get(id)?.topic : undefined;
}

/** True if any of the 8 neighbours holds a card of a different topic. */
function touchesOtherTopic(slot: Slot, topic: string) {
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (!dc && !dr) continue;
      const other = topicAt(slot.col + dc, slot.row + dr);
      if (other !== undefined && other !== topic) return true;
    }
  }
  return false;
}

function homeCell(origin: Slot, index: number): Slot {
  return {
    col: origin.col + (index % HOME_GRID_COLS) * HOME_STRIDE_C,
    row: origin.row + Math.floor(index / HOME_GRID_COLS) * HOME_STRIDE_R,
  };
}

function homesOverlap(cell: Slot) {
  for (const home of topicHome.values()) {
    if (Math.abs(home.col - cell.col) < HOME_STRIDE_C && Math.abs(home.row - cell.row) < HOME_STRIDE_R) {
      return true;
    }
  }
  return false;
}

function chooseHome(topic: string): Slot {
  if (!boardOrigin) {
    const center = cameraSlot();
    boardOrigin = { col: center.col - HOME_STRIDE_C, row: center.row - 1 };
  }
  for (let i = topicHome.size; i < topicHome.size + 36; i++) {
    const cell = homeCell(boardOrigin, i);
    const id = makeSlot(cell.col, cell.row);
    if (occupancy.has(id) || touchesOtherTopic(cell, topic) || homesOverlap(cell)) continue;
    return cell;
  }
  const fallback = nearestEmpty(occupancy, boardOrigin);
  return fallback ? parseSlot(fallback) : cameraSlot();
}

/** Pin the six sample topics to a 3×2 grid before the agent starts filing. */
export function reserveSampleHomes() {
  if (tiles.size > 0) return;
  const center = cameraSlot();
  boardOrigin = { col: center.col - HOME_STRIDE_C, row: center.row - 1 };
  for (const [topic, gc, gr] of SAMPLE_HOME_GRID) {
    if (topicHome.has(topic)) continue;
    topicHome.set(topic, {
      col: boardOrigin.col + gc * HOME_STRIDE_C,
      row: boardOrigin.row + gr * HOME_STRIDE_R,
    });
  }
}

export function topicHomeSlot(topic: string): Slot {
  let home = topicHome.get(topic);
  if (!home) {
    home = chooseHome(topic);
    topicHome.set(topic, home);
  }
  return home;
}

export function pickEmptySlot(topic: string, preferred?: string): SlotId | null {
  if (preferred && isSlotId(preferred) && !occupancy.has(preferred)) {
    // Honour an explicit choice unless it would glue two sections together.
    if (!touchesOtherTopic(parseSlot(preferred), topic)) return preferred;
  }
  const home = topicHomeSlot(topic);
  for (const cell of spiral(home)) {
    if (slotManhattan(cell, home) > SECTION_SEARCH_RADIUS) break;
    const id = makeSlot(cell.col, cell.row);
    if (occupancy.has(id) || touchesOtherTopic(cell, topic)) continue;
    return id;
  }
  return nearestEmpty(occupancy, home);
}

export function placeClip(clipId: string, preferredSlot?: string) {
  const clip = clips.get(clipId);
  if (!clip) {
    return { ok: false as const, reason: "unknown_clip" as const };
  }
  // Tile ids equal clip ids, so "already placed" is a Map lookup, not a scan.
  const already = tiles.get(clipId);
  if (already) {
    return {
      ok: false as const,
      reason: "already_placed" as const,
      createdId: already.id,
      slot: already.slot,
    };
  }
  const slot = pickEmptySlot(clip.topic, preferredSlot);
  if (!slot) {
    return { ok: false as const, reason: "no_empty" as const };
  }
  if (occupancy.has(slot)) {
    return { ok: false as const, reason: "taken" as const };
  }

  const index = pending.indexOf(clipId);
  if (index >= 0) pending.splice(index, 1);

  const tile: Tile = {
    id: clip.id,
    clipId: clip.id,
    slot,
    title: clip.title,
    excerpt: clip.excerpt,
    body: clip.body,
    sourceName: clip.sourceName,
    topic: clip.topic,
    imageUrl: clip.imageUrl,
    mediaType: clip.mediaType,
  };
  tiles.set(tile.id, tile);
  occupancy.set(slot, tile.id);
  indexTopic(tile);
  placedAt.set(tile.id, Date.now());
  transact(() => {
    emitDoc([tile.id]);
    emitIntake();
  });

  return {
    ok: true as const,
    createdId: tile.id,
    clipId: clip.id,
    slot,
    noticed: slotInViewport(parseSlot(slot)),
  };
}

/**
 * Direct bulk insert (stress harness / future import). Skips clips whose slot
 * is taken. Exactly one document emit for the whole batch.
 */
export function insertTiles(batch: Tile[]) {
  const added: string[] = [];
  for (const tile of batch) {
    if (tiles.has(tile.id) || occupancy.has(tile.slot)) continue;
    clips.set(tile.id, {
      id: tile.id,
      title: tile.title,
      excerpt: tile.excerpt,
      body: tile.body,
      sourceName: tile.sourceName,
      topic: tile.topic,
      imageUrl: tile.imageUrl,
      mediaType: tile.mediaType,
    });
    tiles.set(tile.id, tile);
    occupancy.set(tile.slot, tile.id);
    indexTopic(tile);
    added.push(tile.id);
  }
  if (added.length) emitDoc(added);
  return added.length;
}

export function moveTile(tileId: string, to: SlotId) {
  const tile = tiles.get(tileId);
  if (!tile) return false;
  if (tile.slot === to) return true;
  if (occupancy.has(to)) return false;
  occupancy.delete(tile.slot);
  occupancy.set(to, tile.id);
  tiles.set(tileId, { ...tile, slot: to });
  emitDoc([tileId]);
  return true;
}

/**
 * Move several tiles at once (drag of a multi-selection). All origin slots are
 * freed first so a group can shift onto cells it currently occupies; a target
 * taken by a non-moving tile falls back to the nearest empty cell. One emit.
 */
export function moveTiles(moves: { id: string; to: SlotId; pos?: { x: number; y: number } }[]) {
  const moving = new Map<string, Tile>();
  for (const move of moves) {
    const tile = tiles.get(move.id);
    if (tile) moving.set(move.id, tile);
  }
  if (!moving.size) return [];
  for (const tile of moving.values()) occupancy.delete(tile.slot);
  const changed: string[] = [];
  for (const move of moves) {
    const tile = moving.get(move.id);
    if (!tile) continue;
    let to: SlotId | null = move.to;
    if (occupancy.has(to)) to = nearestEmptyOnWall(occupancy, parseSlot(move.to));
    if (!to) to = tile.slot;
    occupancy.set(to, tile.id);
    // A drag commits the drawn position too; the slot stays the agent's
    // occupancy record, the pos is what the wall draws (see lib/layout.ts).
    if (to !== tile.slot || move.pos) {
      tiles.set(tile.id, { ...tile, slot: to, pos: move.pos ?? tile.pos });
      changed.push(tile.id);
    }
  }
  if (changed.length) emitDoc(changed);
  return changed;
}

/** Tiles on screen right now: a grid query, not a scan of every tile. */
export function visibleTiles(): Tile[] {
  const out: Tile[] = [];
  for (const slotId of visibleSlotIds()) {
    const id = occupancy.get(slotId);
    if (!id) continue;
    const tile = tiles.get(id);
    if (tile && slotInViewport(parseSlot(tile.slot))) out.push(tile);
  }
  return out;
}

export function clusterVisible(maxMoves: number) {
  const visible = visibleTiles();
  const groups = new Map<string, Tile[]>();
  for (const tile of visible) {
    const list = groups.get(tile.topic) ?? [];
    list.push(tile);
    groups.set(tile.topic, list);
  }

  const reserved = occupiedSet();
  const planned: { id: string; from: SlotId; to: SlotId; topic: string }[] = [];
  const center = cameraSlot();

  for (const [topic, members] of groups) {
    if (planned.length >= maxMoves) break;
    if (members.length < 2) continue;

    for (const member of members) reserved.delete(member.slot);

    const home = slotCentroid(members.map((m) => parseSlot(m.slot)));
    const mixed: Slot = {
      col: Math.round(home.col * 0.65 + center.col * 0.35),
      row: center.row,
    };

    const targets: SlotId[] = [];
    const taken = new Set(reserved);
    while (targets.length < members.length) {
      const next = nearestEmptyOnWall(taken, mixed);
      if (!next) break;
      targets.push(next);
      taken.add(next);
      reserved.add(next);
    }

    const used = new Set<SlotId>();
    const assign = new Map<string, SlotId>();
    for (const member of members) {
      if (targets.includes(member.slot) && !used.has(member.slot)) {
        assign.set(member.id, member.slot);
        used.add(member.slot);
      }
    }
    for (const member of members) {
      if (assign.has(member.id)) continue;
      const free = targets.find((target) => !used.has(target));
      assign.set(member.id, free ?? member.slot);
      if (free) used.add(free);
    }

    for (const member of members) {
      const to = assign.get(member.id);
      if (!to || to === member.slot) continue;
      if (planned.length >= maxMoves) break;
      planned.push({ id: member.id, from: member.slot, to, topic });
    }
  }

  for (const step of planned) occupancy.delete(step.from);
  const moved = planned.filter((step) => {
    if (occupancy.has(step.to)) {
      occupancy.set(step.from, step.id);
      return false;
    }
    occupancy.set(step.to, step.id);
    const tile = tiles.get(step.id);
    if (tile) tiles.set(step.id, { ...tile, slot: step.to });
    return true;
  });
  if (moved.length) emitDoc(moved.map((step) => step.id));
  return moved;
}
