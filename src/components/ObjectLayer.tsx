
"use client";

import { memo, useSyncExternalStore } from "react";
import { TileCard } from "@/components/TileCard";
import { count } from "@/lib/perf";
import { getServerVisibleEntries, getVisibleEntries, subscribeVisible } from "@/lib/visibility";

/**
 * Renders only the tiles the visibility store says are on (or just off) screen.
 * The entries array keeps its identity while the visible set is unchanged, so
 * panning inside the current cell window costs zero React work here.
 */
export const ObjectLayer = memo(function ObjectLayer() {
  count("layer");
  const entries = useSyncExternalStore(subscribeVisible, getVisibleEntries, getServerVisibleEntries);
  return (
    <>
      {entries.map((entry) => (
        <TileCard key={entry.id} id={entry.id} depth={entry.depth} />
      ))}
    </>
  );
});
