
/**
 * UI interaction state kept OUT of the document store and out of React
 * component state:
 *   - which tile is open in the inspector
 *   - the selection set (single / multi / marquee)
 *   - which tiles are currently being dragged
 *   - a registry of mounted tile elements for direct DOM writes during drag
 *
 * Each concern has its own subscription so a selection change never touches
 * inspector consumers and vice versa. TileCard reads booleans through
 * selectors, so only the affected card re-renders.
 */
type Listener = () => void;

const EMPTY_SET: ReadonlySet<string> = new Set();

/* ---------------- inspector ---------------- */

let openId: string | null = null;
const openListeners = new Set<Listener>();

export function subscribeUi(listener: Listener) {
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
}

export function getOpenId() {
  return openId;
}

export function getServerOpenId(): string | null {
  return null;
}

export function openTile(id: string) {
  if (openId === id) return;
  openId = id;
  for (const listener of openListeners) listener();
}

export function closeTile() {
  if (openId === null) return;
  openId = null;
  for (const listener of openListeners) listener();
}

/* ---------------- welcome ---------------- */

let welcomeOpen = false;
const welcomeListeners = new Set<Listener>();

export function subscribeWelcome(listener: Listener) {
  welcomeListeners.add(listener);
  return () => {
    welcomeListeners.delete(listener);
  };
}

export function getWelcomeOpen() {
  return welcomeOpen;
}

export function getServerWelcomeOpen() {
  return false;
}

export function dismissWelcome() {
  if (!welcomeOpen) return;
  welcomeOpen = false;
  for (const listener of welcomeListeners) listener();
}

/* ---------------- selection ---------------- */

let selected: ReadonlySet<string> = EMPTY_SET;
let selectionVersion = 0;
const selectionListeners = new Set<Listener>();

function emitSelection() {
  selectionVersion += 1;
  for (const listener of selectionListeners) listener();
}

export function subscribeSelection(listener: Listener) {
  selectionListeners.add(listener);
  return () => {
    selectionListeners.delete(listener);
  };
}

export function getSelection() {
  return selected;
}

export function getSelectionVersion() {
  return selectionVersion;
}

export function isSelected(id: string) {
  return selected.has(id);
}

export function readNotSelected() {
  return false;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Replace the selection. No-op (no emit) when the set is unchanged. */
export function setSelection(ids: Iterable<string>) {
  const next = new Set(ids);
  if (sameSet(next, selected)) return;
  selected = next;
  emitSelection();
}

export function toggleSelected(id: string) {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected = next;
  emitSelection();
}

export function clearSelection() {
  if (selected.size === 0) return;
  selected = EMPTY_SET;
  emitSelection();
}

/* ---------------- drag ---------------- */

let dragIds: ReadonlySet<string> = EMPTY_SET;
const dragListeners = new Set<Listener>();

export function subscribeDrag(listener: Listener) {
  dragListeners.add(listener);
  return () => {
    dragListeners.delete(listener);
  };
}

export function getDragIds() {
  return dragIds;
}

export function setDragIds(ids: Iterable<string>) {
  const next = new Set(ids);
  if (sameSet(next, dragIds)) return;
  dragIds = next.size ? next : EMPTY_SET;
  for (const listener of dragListeners) listener();
}

/* ---------------- element registry ---------------- */

const tileElements = new Map<string, HTMLElement>();

export function registerTileElement(id: string, element: HTMLElement | null) {
  if (element) tileElements.set(id, element);
  else tileElements.delete(id);
}

export function getTileElement(id: string) {
  return tileElements.get(id);
}
