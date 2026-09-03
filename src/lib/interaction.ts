
/**
 * Pointer / wheel / keyboard interaction for the scene, outside React.
 *
 *   pointermove ─▶ store latest coords ─▶ one rAF ─▶ DOM writes
 *
 * Modes:
 *   pan      drag on empty wall (inertial coast on release)
 *   tile     drag on a card moves it — and the rest of the selection if the
 *            card is selected — via `--dx/--dy` CSS vars on the lifted cards;
 *            the slot move is committed to the store ONCE on release
 *   marquee  shift+drag on empty wall; hit-tests only mounted tiles against
 *            the screen rectangle each frame, updates the selection set only
 *            when membership changes
 *   wheel    pan; ctrl/⌘+wheel (trackpad pinch) zooms about the cursor
 */
import { getCamera, panBy, panWheel, projectWorld, slotScreenBox, YAW_COS, zoomAt } from "./camera";
import { getLayout, getLayoutCenter } from "./layout";
import { SLOT_H, SLOT_W } from "./constants";
import { makeSlot, parseSlot } from "./slots";
import { getTile, moveTiles } from "./store";
import {
  clearSelection,
  getOpenId,
  getSelection,
  getTileElement,
  getWelcomeOpen,
  setDragIds,
  setSelection,
} from "./ui";
import { followDrag } from "./links";
import { clearSectionDrag, followSectionDrag } from "./sections";
import { getVisibleEntries } from "./visibility";

function worldBox(x: number, y: number, w: number, h: number) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let behind = false;
  const pts = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ];
  for (const [px, py] of pts) {
    const p = projectWorld(px, py);
    if (!Number.isFinite(p.k)) {
      behind = true;
      break;
    }
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, behind };
}

type Mode = "idle" | "pan" | "tile" | "marquee";

const DRAG_THRESHOLD_SQ = 16;
const WHEEL_ZOOM_STEP = 0.01;
const WHEEL_ZOOM_CLAMP = 25;

export function installInteraction(scene: HTMLElement, marquee: HTMLElement) {
  let mode: Mode = "idle";
  let pending: Mode = "idle";
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let vx = 0;
  let vy = 0;
  let raf = 0;
  let coastRaf = 0;

  let dragIds: string[] = [];
  let primary = "";
  let kx = 1;
  let ky = 1;
  let wx = 0;
  let wy = 0;
  let baseSelection: ReadonlySet<string> = new Set();

  const stopCoast = () => {
    cancelAnimationFrame(coastRaf);
    coastRaf = 0;
  };

  const frame = () => {
    raf = 0;
    if (mode === "tile") applyDrag();
    else if (mode === "marquee") applyMarquee();
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  /* ---------- tile drag ---------- */

  function beginTileDrag(id: string) {
    const tile = getTile(id);
    if (!tile) {
      mode = "idle";
      return;
    }
    const selection = getSelection();
    dragIds = selection.has(id) ? Array.from(selection) : [id];
    primary = id;
    // Screen px → world px at the card's depth (perspective factor k).
    const packed = getLayoutCenter(tile.id);
    const slot = parseSlot(tile.slot);
    const center = packed
      ? projectWorld(packed.x, packed.y)
      : projectWorld(slot.col * SLOT_W + SLOT_W / 2, slot.row * SLOT_H + SLOT_H / 2);
    const k = Number.isFinite(center.k) && center.k > 0 ? center.k : 1;
    const zoom = getCamera().zoom;
    kx = 1 / (zoom * YAW_COS * k);
    ky = 1 / (zoom * k);
    wx = 0;
    wy = 0;
    setDragIds(dragIds);
    for (const dragId of dragIds) getTileElement(dragId)?.classList.add("is-lifted");
    scene.classList.add("is-moving");
  }

  function applyDrag() {
    wx = (lastX - startX) * kx;
    wy = (lastY - startY) * ky;
    for (const dragId of dragIds) {
      const element = getTileElement(dragId);
      if (!element) continue;
      element.style.setProperty("--dx", `${wx}px`);
      element.style.setProperty("--dy", `${wy}px`);
    }
    followDrag(dragIds, wx, wy);
    followSectionDrag(dragIds, wx, wy);
  }

  function endTileDrag(commit: boolean) {
    cancelAnimationFrame(raf);
    raf = 0;
    applyDrag();
    const dc = Math.round(wx / SLOT_W);
    const dr = Math.round(wy / SLOT_H);
    for (const dragId of dragIds) {
      const element = getTileElement(dragId);
      if (!element) continue;
      element.classList.remove("is-lifted");
      element.style.removeProperty("--dx");
      element.style.removeProperty("--dy");
    }
    scene.classList.remove("is-moving");
    const moved = Math.abs(wx) >= 1 || Math.abs(wy) >= 1;
    if (commit && moved) {
      const moves: { id: string; to: string; pos?: { x: number; y: number } }[] = [];
      for (const dragId of dragIds) {
        const tile = getTile(dragId);
        if (!tile) continue;
        const box = getLayout(dragId);
        if (box) {
          // Cards are drawn at packed positions, so the drop commits an exact
          // world position; the slot is derived from the new box centre so
          // the agent's occupancy grid stays truthful.
          const pos = { x: box.x + wx, y: box.y + wy };
          const to = makeSlot(
            Math.floor((pos.x + box.w / 2) / SLOT_W),
            Math.floor((pos.y + box.h / 2) / SLOT_H),
          );
          moves.push({ id: dragId, to, pos });
        } else {
          const slot = parseSlot(tile.slot);
          moves.push({ id: dragId, to: makeSlot(slot.col + dc, slot.row + dr) });
        }
      }
      // Single store transaction; layout rebuilds with the dropped cards
      // fixed, edges and sections recompute from the new boxes.
      clearSectionDrag();
      moveTiles(moves);
    } else {
      followDrag(dragIds, 0, 0);
      clearSectionDrag();
    }
    setDragIds([]);
    dragIds = [];
    primary = "";
    swallowClickAfterDrag();
  }

  /**
   * A pointerup that ends a drag also produces a `click`. Swallow exactly that
   * one (capture phase, self-removing, with a short timeout in case the
   * browser emits none) so releasing a card never opens the inspector.
   */
  function swallowClickAfterDrag() {
    const onClick = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
      cleanup();
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      scene.removeEventListener("click", onClick, true);
    };
    const timer = window.setTimeout(cleanup, 250);
    scene.addEventListener("click", onClick, true);
  }

  /* ---------- marquee ---------- */

  function beginMarquee() {
    baseSelection = new Set(getSelection());
    marquee.classList.add("is-active");
  }

  function applyMarquee() {
    const x0 = Math.min(startX, lastX);
    const y0 = Math.min(startY, lastY);
    const x1 = Math.max(startX, lastX);
    const y1 = Math.max(startY, lastY);
    marquee.style.transform = `translate3d(${x0}px, ${y0}px, 0)`;
    marquee.style.width = `${x1 - x0}px`;
    marquee.style.height = `${y1 - y0}px`;
    const hits = new Set(baseSelection);
    // Only mounted (on-screen) tiles can intersect a screen rectangle.
    for (const entry of getVisibleEntries()) {
      const tile = getTile(entry.id);
      if (!tile) continue;
      const packed = getLayout(entry.id);
      const slot = parseSlot(tile.slot);
      const box = packed
        ? worldBox(packed.x, packed.y, packed.w, packed.h)
        : slotScreenBox(slot.col, slot.row);
      if (box.behind) continue;
      if (box.maxX >= x0 && box.minX <= x1 && box.maxY >= y0 && box.minY <= y1) hits.add(entry.id);
    }
    setSelection(hits);
  }

  function endMarquee() {
    cancelAnimationFrame(raf);
    raf = 0;
    applyMarquee();
    marquee.classList.remove("is-active");
    marquee.style.width = "0px";
    marquee.style.height = "0px";
  }

  /* ---------- events ---------- */

  const isHome = () => scene.classList.contains("is-empty");

  const onWheel = (event: WheelEvent) => {
    if (isHome()) return;
    const target = event.target;
    if (target instanceof Element && target.closest(".inspect-layer")) return;
    event.preventDefault();
    stopCoast();
    if (event.ctrlKey || event.metaKey) {
      const delta = Math.max(-WHEEL_ZOOM_CLAMP, Math.min(WHEEL_ZOOM_CLAMP, event.deltaY));
      zoomAt(event.clientX, event.clientY, Math.exp(-delta * WHEEL_ZOOM_STEP));
      return;
    }
    panWheel(event.deltaX, event.deltaY);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (isHome()) return;
    if (event.button !== 0 || getOpenId() || getWelcomeOpen()) return;
    const target = event.target as HTMLElement;
    if (target.closest(".upload-dock, .inspect-layer, .welcome-layer")) return;
    stopCoast();
    startX = lastX = event.clientX;
    startY = lastY = event.clientY;
    vx = 0;
    vy = 0;
    mode = "idle";
    const card = target.closest<HTMLElement>(".tile-card");
    if (card?.dataset.tileId) {
      primary = card.dataset.tileId;
      pending = "tile";
    } else {
      pending = event.shiftKey ? "marquee" : "pan";
    }
    // Capture is taken only once a drag actually starts (see onPointerMove):
    // capturing here would retarget pointerup to the scene and swallow the
    // card's click, which is what opens the inspector.
  };

  const onPointerMove = (event: PointerEvent) => {
    if (pending === "idle" && mode === "idle") return;
    if (mode === "idle") {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD_SQ) return;
      mode = pending;
      if (mode === "tile") beginTileDrag(primary);
      else if (mode === "marquee") beginMarquee();
      else scene.classList.add("is-dragging");
      if (mode === "idle") return;
      try {
        scene.setPointerCapture(event.pointerId);
      } catch {
        /* synthetic pointer */
      }
    }
    if (mode === "pan") {
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      vx = dx;
      vy = dy;
      panBy(dx, dy);
      return;
    }
    lastX = event.clientX;
    lastY = event.clientY;
    schedule();
  };

  const finish = (event: PointerEvent, commit: boolean) => {
    if (pending === "idle" && mode === "idle") return;
    const was = mode;
    const wasPending = pending;
    mode = "idle";
    pending = "idle";
    try {
      scene.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    if (was === "idle") {
      // Plain click on the empty wall clears the selection.
      if (wasPending === "pan" && commit) clearSelection();
      return;
    }
    if (was === "tile") {
      endTileDrag(commit);
      return;
    }
    if (was === "marquee") {
      endMarquee();
      return;
    }
    scene.classList.remove("is-dragging");
    if (!commit) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cx = vx;
    let cy = vy;
    const tick = () => {
      cx *= 0.9;
      cy *= 0.9;
      if (Math.hypot(cx, cy) < 0.35) return;
      panBy(cx, cy);
      coastRaf = requestAnimationFrame(tick);
    };
    coastRaf = requestAnimationFrame(tick);
  };

  const onPointerUp = (event: PointerEvent) => finish(event, true);
  const onPointerCancel = (event: PointerEvent) => finish(event, false);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !getOpenId()) clearSelection();
  };

  scene.addEventListener("wheel", onWheel, { passive: false });
  scene.addEventListener("pointerdown", onPointerDown);
  scene.addEventListener("pointermove", onPointerMove);
  scene.addEventListener("pointerup", onPointerUp);
  scene.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("keydown", onKeyDown);

  return () => {
    scene.removeEventListener("wheel", onWheel);
    scene.removeEventListener("pointerdown", onPointerDown);
    scene.removeEventListener("pointermove", onPointerMove);
    scene.removeEventListener("pointerup", onPointerUp);
    scene.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("keydown", onKeyDown);
    cancelAnimationFrame(raf);
    stopCoast();
  };
}
