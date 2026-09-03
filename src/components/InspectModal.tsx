
"use client";

import { useEffect, useRef, type RefObject } from "react";
import { acquireFullUrl, releaseFullUrl } from "@/lib/assets";
import type { Tile } from "@/lib/types";

type Props = {
  tile: Tile;
  onClose: () => void;
};

export function InspectModal({ tile, onClose }: Props) {
  // The original file is only materialised while the inspector is open, and
  // only for image/video tiles (PDF/text never need it). The thumbnail or
  // poster renders first; the effect swaps the DOM src to the full URL (a
  // direct DOM write avoids an extra React commit) and releases on close.
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement>(null);
  const needsOriginal = tile.mediaType === "image" || tile.mediaType === "video";

  useEffect(() => {
    if (!needsOriginal) return;
    const url = acquireFullUrl(tile.id);
    const media = mediaRef.current;
    if (url && media) media.src = url;
    return () => {
      if (media instanceof HTMLVideoElement) {
        // Stop decoding immediately; don't wait for GC.
        media.pause();
        media.removeAttribute("src");
        media.load();
      }
      releaseFullUrl(tile.id);
    };
  }, [tile.id, needsOriginal]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="inspect-layer" onClick={onClose} role="presentation">
      <article
        className="inspect-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inspect-title"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <header className="inspect-head">
          <p className="inspect-source">{tile.sourceName}</p>
          <button
            type="button"
            className="inspect-close"
            aria-label="Close"
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <div className="inspect-scroll">
          {tile.mediaType === "video" ? (
            <div className="inspect-photo">
              {/* Only place a <video> exists: never on cards. Loads on open. */}
              <video
                ref={mediaRef as RefObject<HTMLVideoElement>}
                className="inspect-video"
                controls
                playsInline
                preload="metadata"
                poster={tile.imageUrl}
              />
            </div>
          ) : tile.imageUrl ? (
            <div className="inspect-photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={mediaRef as RefObject<HTMLImageElement>}
                src={tile.imageUrl}
                alt={tile.title}
                decoding="async"
              />
            </div>
          ) : null}
          <h1 id="inspect-title" className="inspect-title">
            {tile.title}
          </h1>
          {tile.body ? <pre className="inspect-body">{tile.body}</pre> : null}
        </div>
      </article>
    </div>
  );
}
