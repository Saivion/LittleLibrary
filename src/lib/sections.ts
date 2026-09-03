
/**
 * Derived store: one section blob per topic that has a mounted card.
 *
 * The blob is a rounded hull around the packed card boxes, so a cluster
 * reads as one organic pad instead of a grid of cells.
 */
import { getLayout, getTopicBoxes } from "./layout";
import { paddedCorners, roundedHull, type PackedBox } from "./pack";
import { getTile, subscribeDoc, tileIdsForTopic } from "./store";
import { topicHue } from "./topics";
import { getVisibleEntries, subscribeVisible } from "./visibility";

type Listener = () => void;

export type Section = {
  topic: string;
  hue: number;
  d: string;
  labelX: number;
  labelY: number;
  count: number;
};

const PAD = 36;
const RADIUS = 52;

const EMPTY: readonly Section[] = [];
let sections: readonly Section[] = EMPTY;
const cache = new Map<string, { signature: string; section: Section }>();
const listeners = new Set<Listener>();
let started = false;

function hullFor(boxes: readonly PackedBox[]) {
  const points = boxes.flatMap((box) => paddedCorners(box, PAD));
  return roundedHull(points, RADIUS);
}

function labelFor(boxes: readonly PackedBox[]) {
  let x = Number.POSITIVE_INFINITY;
  let y = Number.POSITIVE_INFINITY;
  for (const box of boxes) {
    if (box.y < y || (box.y === y && box.x < x)) {
      y = box.y;
      x = box.x;
    }
  }
  return { labelX: x + 18, labelY: y - PAD + 4 };
}

function recompute() {
  const topics = new Set<string>();
  for (const entry of getVisibleEntries()) {
    const tile = getTile(entry.id);
    if (tile) topics.add(tile.topic);
  }

  if (!topics.size) {
    if (sections !== EMPTY) {
      sections = EMPTY;
      for (const listener of listeners) listener();
    }
    return;
  }

  const next: Section[] = [];
  const used = new Set<string>();
  for (const topic of topics) {
    const boxes = getTopicBoxes(topic);
    if (!boxes.length) continue;
    let signature = "";
    for (const box of boxes) signature += `${box.id}:${Math.round(box.x)},${Math.round(box.y)};`;
    used.add(topic);
    const prev = cache.get(topic);
    if (prev && prev.signature === signature) {
      next.push(prev.section);
      continue;
    }
    const label = labelFor(boxes);
    const section: Section = {
      topic,
      hue: topicHue(topic),
      d: hullFor(boxes),
      labelX: label.labelX,
      labelY: label.labelY,
      count: boxes.length,
    };
    cache.set(topic, { signature, section });
    next.push(section);
  }
  for (const key of cache.keys()) if (!used.has(key)) cache.delete(key);

  let same = next.length === sections.length;
  if (same) {
    for (let i = 0; i < next.length; i++) {
      if (next[i] !== sections[i]) {
        same = false;
        break;
      }
    }
  }
  if (same) return;
  sections = next;
  for (const listener of listeners) listener();
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  subscribeVisible(recompute);
  subscribeDoc(recompute);
  recompute();
}

export function subscribeSections(listener: Listener) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSections() {
  return sections;
}

export function getServerSections() {
  return EMPTY;
}

type SectionSplit = {
  topic: string;
  stayD: string;
  moveD: string;
  labelMoves: boolean;
};

type SectionWriter = (payload: { splits: SectionSplit[]; dx: number; dy: number } | null) => void;

let writeSections: SectionWriter | null = null;
let dragSplit: SectionSplit[] | null = null;

export function bindSectionWriter(writer: SectionWriter | null) {
  writeSections = writer;
}

function splitSections(ids: readonly string[]): SectionSplit[] {
  const moving = new Set(ids);
  const topics = new Set<string>();
  for (const id of ids) {
    const tile = getTile(id);
    if (tile) topics.add(tile.topic);
  }
  const out: SectionSplit[] = [];
  for (const topic of topics) {
    const stay: PackedBox[] = [];
    const move: PackedBox[] = [];
    let topId = "";
    let topY = Number.POSITIVE_INFINITY;
    let topX = Number.POSITIVE_INFINITY;
    for (const id of tileIdsForTopic(topic)) {
      const box = getLayout(id);
      if (!box) continue;
      if (box.y < topY || (box.y === topY && box.x < topX)) {
        topY = box.y;
        topX = box.x;
        topId = id;
      }
      if (moving.has(id)) move.push(box);
      else stay.push(box);
    }
    if (!move.length) continue;
    out.push({
      topic,
      stayD: stay.length ? hullFor(stay) : "",
      moveD: hullFor(move),
      labelMoves: moving.has(topId),
    });
  }
  return out;
}

export function followSectionDrag(ids: readonly string[], dx: number, dy: number) {
  if (ids.length === 0) {
    clearSectionDrag();
    return;
  }
  dragSplit ??= splitSections(ids);
  writeSections?.({ splits: dragSplit, dx, dy });
}

export function clearSectionDrag() {
  if (!dragSplit && !writeSections) return;
  dragSplit = null;
  writeSections?.(null);
}
