
import { createThumbnail, createVideoPoster, deferPreview, registerAsset, setThumbFromBlob } from "./assets";
import { BODY_CHARS, CLIP_CHARS } from "./constants";
import { nextClipId, setClipImage } from "./store";
import { clipExcerpt, clipTitle, prettySource, topicKey } from "./topics";
import type { Clip, MediaType } from "./types";

const IMAGE_RE = /^image\//;
const VIDEO_RE = /^video\//;
const TEXT_RE = /\.(txt|md|markdown)$/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const VIDEO_EXT_RE = /\.(mp4|m4v|webm|mov|ogv)$/i;
/** Width of the PDF first-page preview; the page is never rendered larger. */
const PDF_POSTER_WIDTH = 480;

function toClip(
  id: string,
  sourceName: string,
  body: string,
  mediaType: MediaType,
  imageUrl?: string,
): Clip {
  const full = body.slice(0, BODY_CHARS);
  const preview = full.slice(0, CLIP_CHARS);
  const media = mediaType === "image" || mediaType === "video";
  const title = clipTitle(preview, sourceName);
  return {
    id,
    title,
    excerpt: media ? "" : clipExcerpt(preview, title),
    body: media ? "" : full,
    sourceName,
    // Text-less media has no topic signal of its own: section by kind so
    // photos sit together rather than each opening a one-card section.
    topic: media ? `${mediaType}s` : topicKey(preview, sourceName),
    imageUrl,
    mediaType,
  };
}

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

/** pdf.js is only loaded (and its worker only spawned) when a PDF is dropped. */
function loadPdfJs() {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return pdfjs;
  });
  return pdfjsPromise;
}

type PdfTask = ReturnType<PdfJs["getDocument"]>;

/** Render bounded: a stuck renderer must never keep a document alive. */
const PDF_POSTER_DEADLINE_MS = 6000;

/**
 * PDF text extraction in the pdf.js worker (stops at BODY_CHARS). The loading
 * task is handed back so the deferred poster can reuse the parsed document
 * instead of parsing the file twice; the caller owns destroying it.
 */
async function pdfText(task: PdfTask, fallbackName: string): Promise<string> {
  const pdf = await task.promise;
  const pages: string[] = [];
  let chars = 0;
  for (let pageIndex = 1; pageIndex <= pdf.numPages && chars < BODY_CHARS; pageIndex++) {
    const page = await pdf.getPage(pageIndex);
    const content = await page.getTextContent();
    page.cleanup();
    const text = content.items
      .map((item) => ("str" in item ? String(item.str) : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) {
      pages.push(text);
      chars += text.length + 2;
    }
  }
  return pages.join("\n\n") || prettySource(fallbackName);
}

/**
 * ONE small raster of page 1 for the card, generated after the clip has
 * landed. Uses print intent so pdf.js does not schedule on
 * requestAnimationFrame (which never fires in a background tab). Pages are
 * never rendered at full size; the document is destroyed afterwards.
 */
async function pdfPoster(id: string, file: File, task: PdfTask) {
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: PDF_POSTER_WIDTH / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const render = page.render({ canvasContext: ctx, viewport, canvas, intent: "print" });
    const timer = window.setTimeout(() => render.cancel(), PDF_POSTER_DEADLINE_MS);
    try {
      await render.promise;
    } finally {
      window.clearTimeout(timer);
      page.cleanup();
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.8));
    if (blob) setClipImage(id, setThumbFromBlob(id, file, blob));
  } catch {
    /* poster is optional */
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

export async function parseOneFile(file: File): Promise<Clip | null> {
  if (!isDroppableFile(file)) return null;
  const name = file.name || "file";
  if (IMAGE_RE.test(file.type) || IMAGE_EXT_RE.test(name)) {
    const id = nextClipId();
    const thumb = await createThumbnail(id, file);
    return toClip(id, name, prettySource(name), "image", thumb);
  }
  if (VIDEO_RE.test(file.type) || VIDEO_EXT_RE.test(name)) {
    const id = nextClipId();
    registerAsset(id, file);
    // Poster is deferred: the clip appears now, the frame fills in later.
    deferPreview(async () => {
      const poster = await createVideoPoster(id, file);
      if (poster) setClipImage(id, poster);
    });
    return toClip(id, name, prettySource(name), "video");
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(name)) {
    const id = nextClipId();
    registerAsset(id, file);
    let task: PdfTask | null = null;
    try {
      const pdfjs = await loadPdfJs();
      task = pdfjs.getDocument({ data: await file.arrayBuffer() });
      const text = await pdfText(task, name);
      const owned = task;
      task = null;
      deferPreview(() => pdfPoster(id, file, owned));
      return toClip(id, name, text, "pdf");
    } catch {
      await task?.destroy().catch(() => undefined);
      return toClip(id, name, prettySource(name), "pdf");
    }
  }
  if (file.type.startsWith("text/") || TEXT_RE.test(name) || file.type === "application/markdown") {
    const text = (await file.text()).replace(/\r/g, "").trim();
    return toClip(nextClipId(), name, text || prettySource(name), "text");
  }
  return null;
}

export function isDroppableFile(file: File) {
  const name = file.name || "";
  return (
    IMAGE_RE.test(file.type) ||
    VIDEO_RE.test(file.type) ||
    file.type === "application/pdf" ||
    file.type.startsWith("text/") ||
    /\.(pdf|txt|md|markdown)$/i.test(name) ||
    IMAGE_EXT_RE.test(name) ||
    VIDEO_EXT_RE.test(name)
  );
}

export function snapshotFiles(list: FileList | File[] | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((file) => file && file.size >= 0 && file.name);
}

export function fileBatchKey(files: File[]) {
  return files
    .map((file) => `${file.name}:${file.size}:${file.lastModified}`)
    .sort()
    .join("|");
}
