
import { CLUSTER_MOVE_MAX, PLACE_BATCH_MAX } from "./constants";
import { compactGroup, parseSlot } from "./slots";
import {
  buildOccupancy,
  clusterVisible,
  peekPending,
  placeClip,
  transact,
} from "./store";
import type { BatchResult, ClusterResult, Occupancy, PlaceRequest, PlaceResult } from "./types";

export const TOOL_NAMES = [
  "get_occupancy",
  "place_tile",
  "place_batch",
  "cluster_visible",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

const OCCUPANCY_DESCRIPTION =
  "Read the occupancy grid for the current viewport only. Returns center slot id, nearby empty slot ids, occupied tiles {id, slot, topic, title}, pending clip count, and the next pending clips {id, topic, title}. Work only in this viewport. Use slot ids such as \"3,-1\". Never pass pixel x,y or ask for the rest of the plane or full document text.";

const PLACE_DESCRIPTION =
  "Place one pending clip onto an empty occupancy slot. clipId comes from get_occupancy.next. Optional slotId must be an empty occupancy slot from get_occupancy. If omitted, the page chooses the nearest empty slot to the current viewport, clustered by the clip topic. If the slot is taken, the next empty neighbor is used. Never stacks. Never pass pixel coordinates.";

const BATCH_DESCRIPTION =
  "Place up to 8 pending clips at once using the same occupancy rules as place_tile. Each item is {clipId, slotId?}. Omit slotId to let the page cluster by topic near the current viewport. Never pass x,y. Never stack.";

const CLUSTER_DESCRIPTION =
  "Regroup visible tiles on the occupancy grid by topic into nearby empty slots in the current viewport. Moves at most 8 tiles per call. Use after a topic already has a neighborhood. Never pass pixel coordinates.";

const clipIdSchema = {
  type: "string",
  description: "Pending clip id from get_occupancy.next",
} as const;

const slotIdSchema = {
  type: "string",
  description: 'Occupancy slot id like "3,-1". Never pixel x,y.',
} as const;

export const TOOL_DEFS = [
  {
    name: "get_occupancy" as const,
    description: OCCUPANCY_DESCRIPTION,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "place_tile" as const,
    description: PLACE_DESCRIPTION,
    annotations: { untrustedContentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        clipId: clipIdSchema,
        slotId: slotIdSchema,
      },
      required: ["clipId"],
      additionalProperties: false,
    },
  },
  {
    name: "place_batch" as const,
    description: BATCH_DESCRIPTION,
    annotations: { untrustedContentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        placements: {
          type: "array",
          maxItems: PLACE_BATCH_MAX,
          items: {
            type: "object",
            properties: {
              clipId: clipIdSchema,
              slotId: slotIdSchema,
            },
            required: ["clipId"],
            additionalProperties: false,
          },
        },
      },
      required: ["placements"],
      additionalProperties: false,
    },
  },
  {
    name: "cluster_visible" as const,
    description: CLUSTER_DESCRIPTION,
    annotations: { untrustedContentHint: true },
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

function asRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

export function getOccupancyTool(): Occupancy {
  return buildOccupancy();
}

export function placeTileTool(input: unknown): PlaceResult {
  const rec = asRecord(input);
  const clipId = typeof rec.clipId === "string" ? rec.clipId : "";
  const slotId = typeof rec.slotId === "string" ? rec.slotId : undefined;
  if (!clipId) {
    return { ok: false, reason: "missing_clipId", occupancy: buildOccupancy() };
  }
  const placed = placeClip(clipId, slotId);
  return {
    ok: placed.ok,
    createdId: placed.createdId,
    clipId,
    slot: placed.slot,
    noticed: placed.noticed,
    reason: placed.reason,
    occupancy: buildOccupancy(),
  };
}

function readPlacements(input: unknown): PlaceRequest[] {
  const rec = asRecord(input);
  const raw = rec.placements;
  if (!Array.isArray(raw)) return [];
  const out: PlaceRequest[] = [];
  for (const item of raw.slice(0, PLACE_BATCH_MAX)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.clipId !== "string") continue;
    out.push({
      clipId: row.clipId,
      slotId: typeof row.slotId === "string" ? row.slotId : undefined,
    });
  }
  return out;
}

export function placeBatchTool(input: unknown): BatchResult {
  const placements = readPlacements(input);
  // One store emit for the whole batch instead of one per placement.
  const placed = transact(() => placements.map((item) => placeTileTool(item)));
  return {
    ok: placed.length > 0 && placed.every((p) => p.ok),
    placed,
    occupancy: buildOccupancy(),
  };
}

export function clusterVisibleTool(): ClusterResult {
  const moved = clusterVisible(CLUSTER_MOVE_MAX);
  return {
    ok: true,
    moved,
    occupancy: buildOccupancy(),
  };
}

export function executeNamedTool(name: string, input: unknown): unknown {
  switch (name) {
    case "get_occupancy":
      return getOccupancyTool();
    case "place_tile":
      return placeTileTool(input);
    case "place_batch":
      return placeBatchTool(input);
    case "cluster_visible":
      return clusterVisibleTool();
    default:
      return { ok: false, reason: "unknown_tool", occupancy: buildOccupancy() };
  }
}

export function topicHasNeighborhood(occupancy: Occupancy): boolean {
  const groups = new Map<string, { col: number; row: number }[]>();
  for (const item of occupancy.occupied) {
    const list = groups.get(item.topic) ?? [];
    list.push(parseSlot(item.slot));
    groups.set(item.topic, list);
  }
  for (const slots of groups.values()) {
    if (slots.length >= 2 && !compactGroup(slots)) return true;
  }
  return false;
}

export function pendingFromOccupancy(occupancy: Occupancy): string[] {
  if (occupancy.next.length) return occupancy.next.map((c) => c.id);
  return peekPending(PLACE_BATCH_MAX).map((c) => c.id);
}

export function documentModelContext(): WebMCP.ModelContext | undefined {
  if (typeof document === "undefined") return undefined;
  return document.modelContext;
}

function parseToolResult(result: unknown): unknown {
  if (result == null) return { ok: false, reason: "empty" };
  if (typeof result === "string") {
    try {
      return JSON.parse(result) as unknown;
    } catch {
      return { raw: result };
    }
  }
  return result;
}

export async function callTool(name: ToolName, input: Record<string, unknown> = {}): Promise<unknown> {
  const mc = documentModelContext();
  if (mc && typeof mc.executeTool === "function" && typeof mc.getTools === "function") {
    const tools = await mc.getTools();
    const tool = tools.find((t) => t.name === name);
    if (tool) {
      try {
        return parseToolResult(await mc.executeTool(tool, input));
      } catch {
        return parseToolResult(await mc.executeTool(tool, JSON.stringify(input)));
      }
    }
  }
  return executeNamedTool(name, input);
}
