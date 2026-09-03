
import type { SlotId } from "./slots";

export type AgentTool = "get_occupancy" | "place_tile" | "cluster_visible";
export type AgentPhase = "read" | "reach" | "grab" | "carry" | "place" | "cluster";
export type MediaType = "image" | "video" | "pdf" | "text";

export type Clip = {
  id: string;
  title: string;
  excerpt: string;
  body: string;
  sourceName: string;
  topic: string;
  imageUrl?: string;
  mediaType?: MediaType;
};

export type Curating = {
  id: string;
  title: string;
  tool: AgentTool;
  phase: AgentPhase;
  slot?: SlotId;
};

export type Tile = {
  id: string;
  clipId: string;
  slot: SlotId;
  title: string;
  excerpt: string;
  body: string;
  sourceName: string;
  topic: string;
  imageUrl?: string;
  mediaType?: MediaType;
  /** Hand-placed position (world px, top-left of the card box). Packing treats it as fixed. */
  pos?: { x: number; y: number };
};

export type OccupiedView = {
  id: string;
  slot: SlotId;
  topic: string;
  title: string;
};

export type Occupancy = {
  center: SlotId;
  empty: SlotId[];
  occupied: OccupiedView[];
  pending: number;
  next: { id: string; topic: string; title: string }[];
};

export type PlaceRequest = {
  clipId: string;
  slotId?: string;
};

export type PlaceResult = {
  ok: boolean;
  createdId?: string;
  clipId?: string;
  slot?: SlotId;
  noticed?: boolean;
  reason?: string;
  occupancy: Occupancy;
};

export type BatchResult = {
  ok: boolean;
  placed: PlaceResult[];
  occupancy: Occupancy;
};

export type ClusterMove = {
  id: string;
  from: SlotId;
  to: SlotId;
  topic: string;
};

export type ClusterResult = {
  ok: boolean;
  moved: ClusterMove[];
  occupancy: Occupancy;
};
