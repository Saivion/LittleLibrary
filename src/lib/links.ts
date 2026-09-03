
/**
 * Derived store: connections between cards, drawn by LinkLayer.
 *
 *   visible entries ──┐
 *   document emit ────┴─▶ recompute edges for MOUNTED tiles only ─▶ notify
 *
 * Two kinds of edge, both only between cards that are ON SCREEN (visibility
 * depth 0 — mounted-but-off-screen cards, e.g. the rest of a section, never
 * get a line, so nothing runs off the edge to nowhere), and no two edges are
 * allowed to cross:
 *   topic    minimum spanning tree over a topic's mounted cards, so a cluster
 *            reads as one tree rather than a mesh
 *   keyword  one link per card to the card of another topic sharing the most
 *            (≥ KEYWORD_MIN) significant words, so cross-references show
 *
 * Cost is O(mounted²) at most, never O(document²), and edges keep their
 * identity between recomputes so React only touches paths that changed.
 */
import { getLayoutCenter } from "./layout";
import { SLOT_H, SLOT_W } from "./constants";
import { parseSlot } from "./slots";
import { getTile, subscribeDoc } from "./store";
import { keywordsOf, topicHue } from "./topics";
import type { Tile } from "./types";
import { getVisibleEntries, subscribeVisible } from "./visibility";

type Listener = () => void;

export type Edge = {
  key: string;
  a: string;
  b: string;
  kind: "topic" | "keyword";
  hue: number;
  /** World-space endpoints (card centres). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

const TOPIC_REACH = 12;
const KEYWORD_MIN = 2;
const MAX_EDGES = 160;

const EMPTY: readonly Edge[] = [];
let edges: readonly Edge[] = EMPTY;
const edgeCache = new Map<string, Edge>();
const keywordCache = new WeakMap<Tile, Set<string>>();
const listeners = new Set<Listener>();
let started = false;

function keywords(tile: Tile) {
  let set = keywordCache.get(tile);
  if (!set) {
    set = new Set(keywordsOf(`${tile.title} ${tile.excerpt}`));
    keywordCache.set(tile, set);
  }
  return set;
}

function centre(tile: Tile) {
  const packed = getLayoutCenter(tile.id);
  if (packed) return packed;
  const slot = parseSlot(tile.slot);
  return { x: slot.col * SLOT_W + SLOT_W / 2, y: slot.row * SLOT_H + SLOT_H / 2 };
}

function edgeFor(a: Tile, b: Tile, kind: Edge["kind"]): Edge {
  const [first, second] = a.id < b.id ? [a, b] : [b, a];
  const key = `${first.id}|${second.id}`;
  const prev = edgeCache.get(key);
  const p = centre(first);
  const q = centre(second);
  if (
    prev &&
    prev.kind === kind &&
    prev.x1 === p.x &&
    prev.y1 === p.y &&
    prev.x2 === q.x &&
    prev.y2 === q.y
  ) {
    return prev;
  }
  const next: Edge = {
    key,
    a: first.id,
    b: second.id,
    kind,
    hue: topicHue(kind === "topic" ? first.topic : `${first.topic}+${second.topic}`),
    x1: p.x,
    y1: p.y,
    x2: q.x,
    y2: q.y,
  };
  edgeCache.set(key, next);
  return next;
}

function segmentsCross(a: Edge, b: Edge) {
  if (a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b) return false;
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  const o1 = o(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const o2 = o(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  const o3 = o(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const o4 = o(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

function recompute() {
  const mounted: Tile[] = [];
  for (const entry of getVisibleEntries()) {
    if (entry.depth !== 0) continue;
    const tile = getTile(entry.id);
    if (tile) mounted.push(tile);
  }
  const next: Edge[] = [];
  const seen = new Set<string>();
  const push = (edge: Edge) => {
    if (seen.has(edge.key) || next.length >= MAX_EDGES) return false;
    for (const other of next) if (segmentsCross(edge, other)) return false;
    seen.add(edge.key);
    next.push(edge);
    return true;
  };

  // Topic chains: a minimum spanning tree over the mounted cards of each
  // topic (Prim's), so a cluster reads as one tree with no crossings and no
  // lines running off to cards that are not on screen.
  const byTopic = new Map<string, Tile[]>();
  for (const tile of mounted) {
    const list = byTopic.get(tile.topic) ?? [];
    list.push(tile);
    byTopic.set(tile.topic, list);
  }
  for (const group of byTopic.values()) {
    if (group.length < 2) continue;
    const inTree = new Set<string>([group[0].id]);
    const centres = new Map(group.map((tile) => [tile.id, centre(tile)]));
    while (inTree.size < group.length) {
      let bestA: Tile | null = null;
      let bestB: Tile | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const a of group) {
        if (!inTree.has(a.id)) continue;
        const sa = centres.get(a.id)!;
        for (const b of group) {
          if (inTree.has(b.id)) continue;
          const sb = centres.get(b.id)!;
          const dist = Math.hypot(sa.x - sb.x, sa.y - sb.y);
          if (dist < bestDist) {
            bestDist = dist;
            bestA = a;
            bestB = b;
          }
        }
      }
      if (!bestA || !bestB || bestDist > TOPIC_REACH * SLOT_W) break;
      inTree.add(bestB.id);
      push(edgeFor(bestA, bestB, "topic"));
    }
  }

  // Keyword cross-links: at most one per card, never crossing another line.
  const linked = new Set<string>();
  for (let i = 0; i < mounted.length; i++) {
    const a = mounted[i];
    if (linked.has(a.id)) continue;
    const ka = keywords(a);
    if (ka.size < KEYWORD_MIN) continue;
    let best: Tile | null = null;
    let bestShared = KEYWORD_MIN - 1;
    for (let j = 0; j < mounted.length; j++) {
      const b = mounted[j];
      if (j === i || b.topic === a.topic || linked.has(b.id)) continue;
      let shared = 0;
      for (const word of keywords(b)) if (ka.has(word)) shared += 1;
      if (shared > bestShared) {
        bestShared = shared;
        best = b;
      }
    }
    if (best && push(edgeFor(a, best, "keyword"))) {
      linked.add(a.id);
      linked.add(best.id);
    }
  }

  let same = next.length === edges.length;
  if (same) {
    for (let i = 0; i < next.length; i++) {
      if (next[i] !== edges[i]) {
        same = false;
        break;
      }
    }
  }
  if (same) return;
  if (edgeCache.size > next.length * 3 + 128) {
    for (const key of edgeCache.keys()) if (!seen.has(key)) edgeCache.delete(key);
  }
  edges = next;
  for (const listener of listeners) listener();
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  subscribeVisible(recompute);
  subscribeDoc(recompute);
  recompute();
}

export function subscribeLinks(listener: Listener) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getEdges() {
  return edges;
}

export function getServerEdges() {
  return EMPTY;
}

export function edgePath(edge: Edge) {
  const dx = edge.x2 - edge.x1;
  const dy = edge.y2 - edge.y1;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(90, len * 0.18) * (edge.kind === "topic" ? 1 : -1);
  const mx = (edge.x1 + edge.x2) / 2 - (dy / len) * bow;
  const my = (edge.y1 + edge.y2) / 2 + (dx / len) * bow;
  return `M${edge.x1} ${edge.y1} Q${mx} ${my} ${edge.x2} ${edge.y2}`;
}

type LinkWriter = (edges: readonly Edge[]) => void;
let writeLinks: LinkWriter | null = null;

export function bindLinkWriter(writer: LinkWriter | null) {
  writeLinks = writer;
}

/**
 * Stretch existing edges so they stay attached while cards are dragged.
 * Does not rebuild the graph — only moves endpoints that belong to `ids`.
 * Writes path `d` on the live SVG so the dash animation is not restarted.
 */
export function followDrag(ids: readonly string[], dx: number, dy: number) {
  if (edges === EMPTY || ids.length === 0) return;
  const moving = new Set(ids);
  let changed = false;
  const next: Edge[] = new Array(edges.length);
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const aMove = moving.has(edge.a);
    const bMove = moving.has(edge.b);
    if (!aMove && !bMove) {
      next[i] = edge;
      continue;
    }
    const ta = getTile(edge.a);
    const tb = getTile(edge.b);
    if (!ta || !tb) {
      next[i] = edge;
      continue;
    }
    const p = centre(ta);
    const q = centre(tb);
    const x1 = p.x + (aMove ? dx : 0);
    const y1 = p.y + (aMove ? dy : 0);
    const x2 = q.x + (bMove ? dx : 0);
    const y2 = q.y + (bMove ? dy : 0);
    if (edge.x1 === x1 && edge.y1 === y1 && edge.x2 === x2 && edge.y2 === y2) {
      next[i] = edge;
      continue;
    }
    changed = true;
    next[i] = { ...edge, x1, y1, x2, y2 };
  }
  if (!changed) return;
  edges = next;
  if (writeLinks) writeLinks(edges);
  else for (const listener of listeners) listener();
}
