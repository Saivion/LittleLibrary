
import type { CSSProperties } from "react";
import { mediaKind, tileBox } from "@/lib/media";
import { cardFaceTitle, topicHue } from "@/lib/topics";
import type { MediaType } from "@/lib/types";
import { TileKindMark } from "./TileKindMark";

type Props = {
  title: string;
  excerpt: string;
  imageUrl?: string;
  mediaType?: MediaType;
  topic: string;
  /** False for cards mounted off screen: the body is skipped, the frame is kept. */
  detail?: boolean;
};

/**
 * The face of a card. The wall tile, the intake pile and the card in the
 * agent's hand all render this same markup at world size (`--tile-w/h`) and
 * only differ in how the `.tile-face` element is positioned, so the card
 * never changes appearance when it is picked up or set down.
 */
export function TileFace({ title, excerpt, imageUrl, mediaType, topic, detail = true }: Props) {
  const kind = mediaKind(mediaType);
  const showExcerpt = Boolean(excerpt) && detail && kind !== "image" && kind !== "video";
  return (
    <>
      <TileKindMark type={kind} />
      {imageUrl ? (
        <div className="tile-photo">
          {/* Small generated thumbnail (see lib/assets.ts), never the original. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" decoding="async" draggable={false} />
        </div>
      ) : null}
      <div className="tile-copy">
        <h2 className="tile-title">{cardFaceTitle(title)}</h2>
        {showExcerpt ? <p className="tile-excerpt">{excerpt}</p> : null}
      </div>
      <footer className="tile-meta">
        <span className="tile-topic">{topic.replace(/-/g, " ")}</span>
        <span className="tile-kind">{mediaType ?? "text"}</span>
      </footer>
    </>
  );
}

/** CSS variables every `.tile-face` element needs: its world size and hue. */
export function faceVars(mediaType: MediaType | undefined, topic: string): CSSProperties {
  const box = tileBox(mediaType);
  return {
    ["--tile-w" as string]: `${box.w}px`,
    ["--tile-h" as string]: `${box.h}px`,
    ["--tile-hue" as string]: topicHue(topic),
  };
}
