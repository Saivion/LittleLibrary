
"use client";

import { memo } from "react";
import { registerCarryElement } from "@/lib/carry";
import { mediaKind } from "@/lib/media";
import { count } from "@/lib/perf";
import type { Clip } from "@/lib/types";
import { TileFace, faceVars } from "./TileFace";

/**
 * The card in the agent's hand. A screen-space copy of the tile face whose
 * transform (a `matrix3d` homography) is written every frame by the flight
 * controller, so it sits exactly on the pile card when picked up and exactly
 * on the wall tile when set down. React only mounts and unmounts it.
 */
export const CarryCard = memo(function CarryCard({ clip }: { clip: Clip | null }) {
  count("carry");
  if (!clip) return null;
  return (
    <div className="carry-layer" aria-hidden="true">
      <article
        key={clip.id}
        ref={registerCarryElement}
        className={`carry-card tile-face is-${mediaKind(clip.mediaType)}`}
        style={faceVars(clip.mediaType, clip.topic)}
      >
        <TileFace
          title={clip.title}
          excerpt={clip.excerpt}
          imageUrl={clip.imageUrl}
          mediaType={clip.mediaType}
          topic={clip.topic}
        />
      </article>
    </div>
  );
});
