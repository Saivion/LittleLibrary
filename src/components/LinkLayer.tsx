
"use client";

import { memo, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { bindLinkWriter, edgePath, getEdges, getServerEdges, subscribeLinks } from "@/lib/links";

/**
 * Quiet curves between related cards. One SVG in world space (it rotates
 * and pans with the wall via the parent transform), one path per edge.
 * Sits just below the cards in Z so lines meet card edges.
 * Drag updates write `d` here directly so the dash keeps running.
 */
export const LinkLayer = memo(function LinkLayer() {
  const edges = useSyncExternalStore(subscribeLinks, getEdges, getServerEdges);
  const nodes = useRef(new Map<string, SVGPathElement>());

  useLayoutEffect(() => {
    const map = nodes.current;
    bindLinkWriter((next) => {
      for (const edge of next) {
        map.get(edge.key)?.setAttribute("d", edgePath(edge));
      }
    });
    return () => bindLinkWriter(null);
  }, []);

  useLayoutEffect(() => {
    const map = nodes.current;
    for (const edge of edges) map.get(edge.key)?.setAttribute("d", edgePath(edge));
  }, [edges]);

  if (!edges.length) return null;
  return (
    <svg className="links" aria-hidden="true">
      {edges.map((edge) => (
        <path
          key={edge.key}
          ref={(node) => {
            if (node) nodes.current.set(edge.key, node);
            else nodes.current.delete(edge.key);
          }}
          className={`link is-${edge.kind}`}
          d={edgePath(edge)}
        />
      ))}
    </svg>
  );
});
