
import { SLOT_H, SLOT_W } from "./constants";
import type { MediaType } from "./types";

export function mediaKind(type?: MediaType): MediaType {
  return type ?? "text";
}

/** Visual card box inside a fixed occupancy slot. Images fill more of the cell. */
export function tileBox(media?: MediaType) {
  switch (mediaKind(media)) {
    case "image":
    case "video":
      return { w: 220, h: 268 };
    case "pdf":
      return { w: 196, h: 236 };
    default:
      return { w: 180, h: 220 };
  }
}

export function tileOrigin(col: number, row: number, media?: MediaType) {
  const { w, h } = tileBox(media);
  return {
    left: col * SLOT_W + (SLOT_W - w) / 2,
    top: row * SLOT_H + (SLOT_H - h) / 2,
    w,
    h,
  };
}

export type TileJitter = { jx: number; jy: number; rot: number };

/**
 * Small leftover offset and tilt so a packed cluster still feels pinned by
 * hand. Shared by the wall card and the card in the agent's hand: the drop
 * only reads as continuous if both agree on the final pose.
 */
export function tileJitter(id: string): TileJitter {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const a = ((h >>> 0) % 1000) / 1000;
  const b = ((h >>> 10) % 1000) / 1000;
  const c = ((h >>> 20) % 1000) / 1000;
  return {
    jx: Math.round((a - 0.5) * 8),
    jy: Math.round((b - 0.5) * 8),
    rot: +((c - 0.5) * 6.2).toFixed(2),
  };
}

/**
 * The intake pile draws full-size card faces scaled down to one shared
 * width, so text, pdf and image cards stack evenly (their aspect ratios are
 * within 2% of each other) and the face never changes when it is picked up.
 */
export const INTAKE_CARD_W = 108;

export function intakeFit(media?: MediaType) {
  return INTAKE_CARD_W / tileBox(media).w;
}
