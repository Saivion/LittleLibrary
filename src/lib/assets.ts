/**
 * Asset registry + thumbnail pipeline.
 *
 * - Cards never display the original file. Each image gets ONE small thumbnail
 *   (≤ THUMB_MAX px on the long side) generated asynchronously with
 *   createImageBitmap({ resizeWidth }) which decodes at reduced size off the
 *   main thread in Chromium, then re-encoded as a small blob.
 * - The full-resolution object URL is created only when the inspector opens
 *   and revoked shortly after it closes (ref-counted).
 * - Every URL.createObjectURL has a matching revoke: thumbnails on dispose /
 *   pagehide, full URLs on release.
 */

const THUMB_MAX = 480;
const THUMB_CONCURRENCY = 3;
const FULL_RELEASE_DELAY_MS = 1500;

type Asset = {
  file: File;
  thumbUrl?: string;
  fullUrl?: string;
  fullRefs: number;
  releaseTimer: number;
};

const assets = new Map<string, Asset>();
let active = 0;
const queue: (() => void)[] = [];

function gate(): Promise<() => void> {
  return new Promise((resolve) => {
    const grant = () => {
      active += 1;
      let done = false;
      resolve(() => {
        if (done) return;
        done = true;
        active -= 1;
        const next = queue.shift();
        if (next) next();
      });
    };
    if (active < THUMB_CONCURRENCY) grant();
    else queue.push(grant);
  });
}

export function registerAsset(id: string, file: File) {
  const existing = assets.get(id);
  if (existing) {
    existing.file = file;
    return existing;
  }
  const asset: Asset = { file, fullRefs: 0, releaseTimer: 0 };
  assets.set(id, asset);
  return asset;
}

function isVectorOrTiny(file: File) {
  return file.type === "image/svg+xml" || /\.svg$/i.test(file.name) || file.size < 24 * 1024;
}

async function encodeCanvas(bitmap: ImageBitmap, w: number, h: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    try {
      return await canvas.convertToBlob({ type: "image/webp", quality: 0.82 });
    } catch {
      return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
}

async function decodeScaled(file: File): Promise<ImageBitmap> {
  try {
    // Preferred: decode directly at reduced size (aspect preserved by the UA).
    return await createImageBitmap(file, {
      resizeWidth: THUMB_MAX,
      resizeQuality: "medium",
    });
  } catch {
    // Fallback: full decode via <img>, still async, then scaled on draw.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      const scale = Math.min(1, THUMB_MAX / Math.max(1, img.naturalWidth));
      return await createImageBitmap(img, {
        resizeWidth: Math.max(1, Math.round(img.naturalWidth * scale)),
        resizeHeight: Math.max(1, Math.round(img.naturalHeight * scale)),
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Produce a small preview URL for an image file. Never throws: on any failure
 * the original file URL is returned so the feature degrades, not disappears.
 */
export async function createThumbnail(id: string, file: File): Promise<string> {
  const asset = registerAsset(id, file);
  if (asset.thumbUrl) return asset.thumbUrl;
  if (isVectorOrTiny(file) || typeof createImageBitmap !== "function") {
    asset.thumbUrl = URL.createObjectURL(file);
    return asset.thumbUrl;
  }
  const release = await gate();
  try {
    const bitmap = await decodeScaled(file);
    try {
      const blob = await encodeCanvas(bitmap, bitmap.width, bitmap.height);
      asset.thumbUrl = URL.createObjectURL(blob ?? file);
    } finally {
      bitmap.close();
    }
  } catch {
    asset.thumbUrl = URL.createObjectURL(file);
  } finally {
    release();
  }
  return asset.thumbUrl;
}

/** Attach an already-generated preview blob (PDF first page, video poster). */
export function setThumbFromBlob(id: string, file: File, blob: Blob) {
  const asset = registerAsset(id, file);
  if (asset.thumbUrl) URL.revokeObjectURL(asset.thumbUrl);
  asset.thumbUrl = URL.createObjectURL(blob);
  return asset.thumbUrl;
}

function once<T extends Event>(target: EventTarget, type: string, timeoutMs: number) {
  return new Promise<T | null>((resolve) => {
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    const onEvent = (event: Event) => {
      cleanup();
      resolve(event as T);
    };
    const onError = () => {
      cleanup();
      resolve(null);
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      target.removeEventListener(type, onEvent);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(type, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

const POSTER_DEADLINE_MS = 8000;

function sleep(ms: number) {
  return new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), ms));
}

async function captureVideoFrame(video: HTMLVideoElement): Promise<Blob | null> {
  if (!(await once(video, "loadedmetadata", 6000))) return null;
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  video.currentTime = Math.min(0.5, duration / 2);
  if (!(await once(video, "seeked", 6000))) return null;
  // Prefer a real decoded frame when the API exists; otherwise seeked suffices.
  if ("requestVideoFrameCallback" in video) {
    await Promise.race([
      new Promise<void>((resolve) =>
        (video as HTMLVideoElement & { requestVideoFrameCallback(cb: () => void): number })
          .requestVideoFrameCallback(() => resolve()),
      ),
      sleep(1500),
    ]);
  }
  const w = video.videoWidth || 1;
  const h = video.videoHeight || 1;
  const scale = Math.min(1, THUMB_MAX / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // drawImage never blocks on frame availability (it draws nothing if none).
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.8));
}

/**
 * Poster frame for a video file. A detached <video> seeks to an early frame,
 * one frame is drawn to a small canvas, then the element is unloaded so no
 * decoder stays alive. Bounded by POSTER_DEADLINE_MS so a stalled decoder can
 * never hold up the upload batch. Cards only ever show this poster; the video
 * element exists solely inside the inspector.
 */
export async function createVideoPoster(id: string, file: File): Promise<string | undefined> {
  const asset = registerAsset(id, file);
  if (asset.thumbUrl) return asset.thumbUrl;
  const release = await gate();
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  try {
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = url;
    const blob = await Promise.race([captureVideoFrame(video), sleep(POSTER_DEADLINE_MS)]);
    if (!blob) return undefined;
    return setThumbFromBlob(id, file, blob);
  } catch {
    return undefined;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
    release();
  }
}

/**
 * Run preview work after the current batch has landed, at idle priority (with
 * a timeout so it still happens on a busy main thread). Visible objects first,
 * lower-priority previews afterwards.
 */
export function deferPreview(work: () => Promise<void>) {
  const run = () => {
    void work().catch(() => undefined);
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2000 });
  else window.setTimeout(run, 0);
}

export function getThumbUrl(id: string) {
  return assets.get(id)?.thumbUrl;
}

/** Full-resolution URL for the inspector. Pair with releaseFullUrl. */
export function acquireFullUrl(id: string): string | undefined {
  const asset = assets.get(id);
  if (!asset) return undefined;
  if (asset.releaseTimer) {
    window.clearTimeout(asset.releaseTimer);
    asset.releaseTimer = 0;
  }
  asset.fullRefs += 1;
  asset.fullUrl ??= URL.createObjectURL(asset.file);
  return asset.fullUrl;
}

export function releaseFullUrl(id: string) {
  const asset = assets.get(id);
  if (!asset) return;
  asset.fullRefs = Math.max(0, asset.fullRefs - 1);
  if (asset.fullRefs > 0 || !asset.fullUrl) return;
  // Small grace period so re-opening the same tile doesn't churn the blob.
  asset.releaseTimer = window.setTimeout(() => {
    asset.releaseTimer = 0;
    if (asset.fullRefs === 0 && asset.fullUrl) {
      URL.revokeObjectURL(asset.fullUrl);
      asset.fullUrl = undefined;
    }
  }, FULL_RELEASE_DELAY_MS);
}

export function disposeAsset(id: string) {
  const asset = assets.get(id);
  if (!asset) return;
  if (asset.thumbUrl) URL.revokeObjectURL(asset.thumbUrl);
  if (asset.fullUrl) URL.revokeObjectURL(asset.fullUrl);
  if (asset.releaseTimer) window.clearTimeout(asset.releaseTimer);
  assets.delete(id);
}

export function assetStats() {
  let thumbs = 0;
  let fulls = 0;
  let bytes = 0;
  for (const asset of assets.values()) {
    if (asset.thumbUrl) thumbs += 1;
    if (asset.fullUrl) fulls += 1;
    bytes += asset.file.size;
  }
  return { assets: assets.size, thumbs, fullUrls: fulls, sourceBytes: bytes };
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    for (const id of Array.from(assets.keys())) disposeAsset(id);
  });
}
