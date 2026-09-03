
export type SlotId = string;
export type Slot = { col: number; row: number };

/**
 * Anything that can answer "is this slot taken?". The store passes its live
 * occupancy Map directly so placement never copies the whole grid.
 */
export type SlotLookup = { has(id: SlotId): boolean };

const SLOT_RE = /^-?\d+,-?\d+$/;

export function isSlotId(value: unknown): value is SlotId {
  return typeof value === "string" && SLOT_RE.test(value);
}

export function makeSlot(col: number, row: number): SlotId {
  return `${col},${row}`;
}

export function parseSlot(id: SlotId): Slot {
  const comma = id.indexOf(",");
  return {
    col: Number(id.slice(0, comma)),
    row: Number(id.slice(comma + 1)),
  };
}

export function slotManhattan(a: Slot, b: Slot): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

export function slotCentroid(slots: Slot[]): Slot {
  if (slots.length === 0) return { col: 0, row: 0 };
  let col = 0;
  let row = 0;
  for (const slot of slots) {
    col += slot.col;
    row += slot.row;
  }
  return {
    col: Math.round(col / slots.length),
    row: Math.round(row / slots.length),
  };
}

/** Walk rings around origin forever: origin, then square layers. */
export function* spiral(origin: Slot): Generator<Slot> {
  yield origin;
  let layer = 1;
  while (true) {
    for (let i = -layer; i < layer; i++) {
      yield { col: origin.col + layer, row: origin.row + i };
    }
    for (let i = layer; i > -layer; i--) {
      yield { col: origin.col + i, row: origin.row + layer };
    }
    for (let i = layer; i > -layer; i--) {
      yield { col: origin.col - layer, row: origin.row + i };
    }
    for (let i = -layer; i < layer; i++) {
      yield { col: origin.col + i, row: origin.row - layer };
    }
    layer += 1;
  }
}

export function nearestEmpty(
  occupied: SlotLookup,
  origin: Slot,
  maxRadius = 80,
): SlotId | null {
  for (const cell of spiral(origin)) {
    if (slotManhattan(cell, origin) > maxRadius) return null;
    const id = makeSlot(cell.col, cell.row);
    if (!occupied.has(id)) return id;
  }
  return null;
}

/** Prefer a hung row, then neighboring rows. Keeps a facing wall readable. */
export function nearestEmptyOnWall(
  occupied: SlotLookup,
  origin: Slot,
  maxRadius = 12,
): SlotId | null {
  for (let radius = 0; radius <= maxRadius; radius++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const id = makeSlot(origin.col + dc, origin.row);
      if (!occupied.has(id)) return id;
    }
    if (radius === 0) continue;
    for (const dr of [-1, 1, -2, 2]) {
      if (Math.abs(dr) > radius) continue;
      for (let dc = -radius; dc <= radius; dc++) {
        const id = makeSlot(origin.col + dc, origin.row + dr);
        if (!occupied.has(id)) return id;
      }
    }
  }
  return nearestEmpty(occupied, origin);
}

export function neighbors8(slot: Slot): Slot[] {
  const out: Slot[] = [];
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (dc === 0 && dr === 0) continue;
      out.push({ col: slot.col + dc, row: slot.row + dr });
    }
  }
  return out;
}

export function compactGroup(slots: Slot[]): boolean {
  if (slots.length <= 1) return true;
  const set = new Set(slots.map((s) => makeSlot(s.col, s.row)));
  for (const slot of slots) {
    const touching = neighbors8(slot).some((n) => set.has(makeSlot(n.col, n.row)));
    if (!touching) return false;
  }
  return true;
}
