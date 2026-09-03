
/**
 * Dev-only stress harness. Never imported in production paths except via the
 * NODE_ENV-guarded call in PlaneApp.
 *
 *   window.__canvas.seed(n, { images, imageSize })  place n tiles in one emit
 *   window.__canvas.pan(dx, dy) / zoom(f) / flush()  drive the camera
 *   window.__canvas.stats()                           render counters etc.
 *   ?stress=N&images=M                                seed on load
 */
import { assetStats, createThumbnail, createVideoPoster, registerAsset } from "./assets";
import { flushCamera, getCamera, panBy, setCamera, setZoom, tileScreenQuad, zoomAt } from "./camera";
import { getCarrySnapshot, intakeCardQuad, intakeGrip } from "./carry";
import { getHand } from "./hand";
import { ingestFiles } from "./ingest";
import { getLayout } from "./layout";
import { tileJitter } from "./media";
import { counters, resetCounters } from "./perf";
import { makeSlot } from "./slots";
import { enqueueClip, getTile, moveTile, moveTiles, insertTiles, placeClip, setCurating, tileCount } from "./store";
import { clearSelection, closeTile, getSelection, getTileElement, openTile, setSelection, toggleSelected } from "./ui";
import type { Tile } from "./types";
import { getVisibleEntries } from "./visibility";

const TOPICS = ["pricing", "architecture", "launch", "research", "legal", "notes", "design", "ops"];

export function makeImageFile(i: number, w: number, h: number): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const fill = ctx.createLinearGradient(0, 0, w, h);
  fill.addColorStop(0, `hsl(${(i * 47) % 360} 70% 55%)`);
  fill.addColorStop(1, `hsl(${(i * 47 + 120) % 360} 70% 35%)`);
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = `${Math.round(h / 8)}px serif`;
  ctx.fillText(`Image ${i}`, w * 0.08, h * 0.5);
  return new Promise((resolve) =>
    canvas.toBlob(
      (blob) => resolve(new File([blob!], `image-${i}.jpg`, { type: "image/jpeg" })),
      "image/jpeg",
      0.85,
    ),
  );
}

export async function seedStress(n: number, opts: { images?: number; imageSize?: number } = {}) {
  const images = Math.min(n, opts.images ?? Math.round(n * 0.2));
  const size = opts.imageSize ?? 3000;
  const cols = Math.ceil(Math.sqrt(n * 1.8));
  const rows = Math.ceil(n / cols);
  const base = tileCount();
  const t0 = performance.now();
  const files: File[] = [];
  for (let i = 0; i < images; i++) files.push(await makeImageFile(i, size, Math.round(size * 0.66)));
  const tGen = performance.now();
  const thumbs = await Promise.all(files.map((file, i) => createThumbnail(`s${base + i}`, file)));
  const tThumb = performance.now();
  const batch: Tile[] = [];
  for (let i = 0; i < n; i++) {
    const topic = TOPICS[i % TOPICS.length];
    const isImage = i < images;
    const id = `s${base + i}`;
    if (isImage) registerAsset(id, files[i]);
    const col = (i % cols) - Math.floor(cols / 2);
    const row = Math.floor(i / cols) - Math.floor(rows / 2);
    batch.push({
      id,
      clipId: id,
      slot: makeSlot(col, row),
      title: `${topic} ${i}: ${isImage ? "photo" : "note about " + topic}`,
      excerpt: isImage ? "" : `Body text for ${topic} item ${i}. `.repeat(4),
      body: isImage ? "" : `Body text for ${topic} item ${i}. `.repeat(40),
      sourceName: isImage ? `image-${i}.jpg` : `${topic}-${i}.md`,
      topic,
      imageUrl: isImage ? thumbs[i] : undefined,
    });
  }
  const inserted = insertTiles(batch);
  const t1 = performance.now();
  return {
    n,
    inserted,
    images,
    cols,
    rows,
    genMs: Math.round(tGen - t0),
    thumbMs: Math.round(tThumb - tGen),
    insertMs: Math.round(t1 - tThumb),
  };
}

export function installDevHarness() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __canvas?: unknown };
  if (w.__canvas) return;
  w.__canvas = {
    seed: seedStress,
    makeImage: makeImageFile,
    thumbnail: createThumbnail,
    poster: createVideoPoster,
    ingest: ingestFiles,
    pan: panBy,
    zoom: (factor: number) => zoomAt(window.innerWidth / 2, window.innerHeight / 2, factor),
    setZoom,
    setCamera,
    tile: getTile,
    open: openTile,
    close: closeTile,
    flush: flushCamera,
    camera: getCamera,
    curate: setCurating,
    enqueue: enqueueClip,
    place: placeClip,
    move: moveTile,
    moveMany: moveTiles,
    select: setSelection,
    toggle: toggleSelected,
    clearSelection,
    selection: () => Array.from(getSelection()),
    /**
     * Projected screen quad of a wall card vs. its DOM bounding box. The
     * carried card is mapped onto this quad, so the two must agree to a px.
     */
    agent: () => ({
      hand: getHand(),
      camera: getCamera(),
      inner: [window.innerWidth, window.innerHeight],
      carry: getCarrySnapshot(),
      pile: Array.from(document.querySelectorAll<HTMLElement>(".intake-card")).map((el) => ({
        id: el.textContent?.slice(0, 18),
        transform: getComputedStyle(el).transform,
        size: [el.offsetWidth, el.offsetHeight],
      })),
    }),
    grip: (id: string) => ({ grip: intakeGrip(id), quad: intakeCardQuad(id) }),
    quad: (id: string) => {
      const box = getLayout(id);
      const cam = getCamera();
      const quad = box ? tileScreenQuad(box, tileJitter(id)) : null;
      const rect = getTileElement(id)?.getBoundingClientRect();
      if (!quad || !rect) return { quad, rect: rect ?? null };
      const xs = quad.map((p) => p.x);
      const ys = quad.map((p) => p.y);
      return {
        box,
        cam,
        projected: {
          left: Math.min(...xs),
          top: Math.min(...ys),
          right: Math.max(...xs),
          bottom: Math.max(...ys),
        },
        dom: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      };
    },
    stats: () => ({
      ...counters,
      tiles: tileCount(),
      visible: getVisibleEntries().length,
      mounted: document.querySelectorAll(".tile-card").length,
      selected: getSelection().size,
      dom: document.querySelectorAll("*").length,
      imgs: document.images.length,
      ...assetStats(),
    }),
    reset: resetCounters,
  };
  const params = new URLSearchParams(window.location.search);
  const stress = Number(params.get("stress"));
  if (stress > 0) {
    const images = params.has("images") ? Number(params.get("images")) : undefined;
    const imageSize = params.has("size") ? Number(params.get("size")) : undefined;
    void seedStress(stress, { images, imageSize });
  }
}
