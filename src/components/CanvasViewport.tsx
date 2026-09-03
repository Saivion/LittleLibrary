
"use client";

import { memo, useEffect, useRef } from "react";
import { LinkLayer } from "@/components/LinkLayer";
import { ObjectLayer } from "@/components/ObjectLayer";
import { SectionLayer } from "@/components/SectionLayer";
import { subscribeCamera, worldTransform } from "@/lib/camera";

/**
 * The world container. Pan/zoom are applied by writing ONE transform on this
 * node from the camera's per-frame listener; React is not involved. The
 * component takes no props and holds no state, so it never re-renders after
 * mount, which also shields ObjectLayer from parent updates.
 */
export const CanvasViewport = memo(function CanvasViewport() {
  const worldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const apply = () => {
      const node = worldRef.current;
      if (node) node.style.transform = worldTransform();
    };
    apply();
    return subscribeCamera(apply);
  }, []);

  return (
    <div ref={worldRef} className="world" style={{ transform: worldTransform() }}>
      <div className="wall" />
      <SectionLayer />
      <LinkLayer />
      <ObjectLayer />
    </div>
  );
});
