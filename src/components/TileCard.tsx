
"use client";

import {
  memo,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { inboxFromDelta } from "@/lib/camera";
import { isHeld, isLanding, subscribeCarry } from "@/lib/carry";
import { getLayout, getServerLayout, subscribeLayoutId } from "@/lib/layout";
import { mediaKind, tileJitter, tileOrigin } from "@/lib/media";
import { count } from "@/lib/perf";
import { parseSlot } from "@/lib/slots";
import { getCurating, getTile, recentlyPlaced, subscribeTile } from "@/lib/store";
import { topicHue } from "@/lib/topics";
import {
  isSelected,
  openTile,
  readNotSelected,
  registerTileElement,
  subscribeSelection,
  toggleSelected,
} from "@/lib/ui";
import { TileFace } from "./TileFace";

type Props = {
  id: string;
  depth: 0 | 1;
};

/** Tiles that already played their deal-in animation (per page lifetime). */
const dealt = new Set<string>();

function readFalse() {
  return false;
}

/**
 * One card on the wall. Subscribes to ITS OWN tile record and to boolean
 * selectors ("am I in the agent's hand", "am I landing", "am I selected"),
 * so a move of tile #42, an agent phase change or a selection change
 * re-renders exactly the affected cards. Position is a compositor transform
 * via CSS vars; during a drag the interaction layer writes `--dx/--dy`
 * directly on the element.
 */
function TileCardInner({ id, depth }: Props) {
  count("tile");
  const subscribe = useCallback((listener: () => void) => {
    const stopTile = subscribeTile(id, listener);
    const stopLayout = subscribeLayoutId(id, listener);
    return () => {
      stopTile();
      stopLayout();
    };
  }, [id]);
  const read = useCallback(() => getTile(id), [id]);
  const tile = useSyncExternalStore(subscribe, read, read);
  // The tile record can stay identical while its packed box changes (a
  // hand-placed neighbour, a pruned topic). A primitive snapshot of the box
  // makes React re-render exactly then, and never otherwise.
  const readBox = useCallback(() => {
    const box = getLayout(id);
    return box ? `${box.x},${box.y},${box.w},${box.h}` : "";
  }, [id]);
  const readServerBox = useCallback(() => "", []);
  useSyncExternalStore(subscribe, readBox, readServerBox);
  // While the agent's ghost draws this card the wall copy stays invisible;
  // the two swap in a single commit when the ghost lets go.
  const readHeld = useCallback(() => isHeld(id), [id]);
  const held = useSyncExternalStore(subscribeCarry, readHeld, readFalse);
  const readLanding = useCallback(() => isLanding(id), [id]);
  const landing = useSyncExternalStore(subscribeCarry, readLanding, readFalse);
  const readSelected = useCallback(() => isSelected(id), [id]);
  const selected = useSyncExternalStore(subscribeSelection, readSelected, readNotSelected);
  const register = useCallback((element: HTMLElement | null) => registerTileElement(id, element), [id]);

  // Deal-in plays once, and only for tiles placed moments ago. The origin is
  // captured in a lazy state initialiser so the camera is read exactly once
  // per mounted card; re-entering the viewport after being culled, or first
  // scrolling to an old tile, mounts it in place with no animation.
  const [intro] = useState(() => {
    if (!tile || dealt.has(id) || !recentlyPlaced(id)) return { deal: false, fromX: 0, fromY: 0 };
    // The agent carried this card onto the wall by hand; don't fly it in from the inbox.
    if (getCurating()?.id === id || isHeld(id)) return { deal: false, fromX: 0, fromY: 0 };
    const packed = getLayout(id);
    const slot = parseSlot(tile.slot);
    const origin = packed
      ? { left: packed.x, top: packed.y }
      : tileOrigin(slot.col, slot.row, tile.mediaType);
    const from = inboxFromDelta(origin.left, origin.top);
    return { deal: true, fromX: from.x, fromY: from.y };
  });
  useEffect(() => {
    dealt.add(id);
  }, [id]);

  // Click opens (unchanged); shift/⌘-click toggles selection. The click that
  // ends a drag is swallowed by the interaction layer before it gets here.
  const onClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (event.shiftKey || event.metaKey || event.ctrlKey) toggleSelected(id);
      else openTile(id);
    },
    [id],
  );
  const onKey = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openTile(id);
      }
    },
    [id],
  );

  if (!tile) return null;

  const hue = topicHue(tile.topic);
  const kind = mediaKind(tile.mediaType);
  const packed = getLayout(id) ?? getServerLayout(id);
  const slot = parseSlot(tile.slot);
  const grid = tileOrigin(slot.col, slot.row, kind);
  const origin = packed
    ? { left: packed.x, top: packed.y, w: packed.w, h: packed.h }
    : grid;
  const jitter = tileJitter(id);

  return (
    <article
      ref={register}
      data-tile-id={id}
      className={`tile-card tile-face is-${kind}${intro.deal ? " is-dealt" : ""} depth-${depth}${
        held ? " is-held" : ""
      }${landing ? " is-landing" : ""}${selected ? " is-selected" : ""}`}
      style={{
        ["--x" as string]: `${origin.left}px`,
        ["--y" as string]: `${origin.top}px`,
        ["--tile-w" as string]: `${origin.w}px`,
        ["--tile-h" as string]: `${origin.h}px`,
        ["--jx" as string]: `${jitter.jx}px`,
        ["--jy" as string]: `${jitter.jy}px`,
        ["--rot" as string]: `${jitter.rot}deg`,
        ["--tile-hue" as string]: hue,
        ["--from-x" as string]: `${intro.fromX}px`,
        ["--from-y" as string]: `${intro.fromY}px`,
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${tile.title}`}
      aria-pressed={selected}
      onClick={onClick}
      onKeyDown={onKey}
    >
      <TileFace
        title={tile.title}
        excerpt={tile.excerpt}
        imageUrl={tile.imageUrl}
        mediaType={tile.mediaType}
        topic={tile.topic}
        detail={depth === 0}
      />
    </article>
  );
}

export const TileCard = memo(TileCardInner);
