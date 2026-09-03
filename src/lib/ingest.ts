
/**
 * Bulk upload pipeline.
 *
 *   files ─▶ parse (≤ PARSE_CONCURRENCY in flight; PDFs in the pdf.js worker,
 *            image thumbnails via async decode) ─▶ ordered result buffer
 *         ─▶ flushed to the store every FLUSH_MS as ONE `enqueueClips` emit
 *
 * 47 files therefore cost a handful of intake emits, not 47 React commits,
 * and the main thread stays free between awaits so panning keeps working.
 */
import { scheduleOrganize } from "./agent";
import { isDroppableFile, parseOneFile, snapshotFiles } from "./parse";
import { beginParse, endParse, enqueueClips } from "./store";
import type { Clip } from "./types";

const PARSE_CONCURRENCY = 3;
const FLUSH_MS = 90;

export async function ingestFiles(files: File[] | FileList | null | undefined) {
  const batch = snapshotFiles(files).filter(isDroppableFile);
  if (!batch.length) return 0;

  beginParse();
  const results: (Clip | null | undefined)[] = new Array<Clip | null | undefined>(batch.length);
  let nextIndex = 0;
  let flushed = 0;
  let timer = 0;
  let accepted = 0;

  const flush = () => {
    const out: Clip[] = [];
    while (flushed < results.length && results[flushed] !== undefined) {
      const clip = results[flushed];
      if (clip) out.push(clip);
      flushed += 1;
    }
    if (out.length) {
      accepted += out.length;
      enqueueClips(out);
    }
  };
  const scheduleFlush = () => {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      flush();
    }, FLUSH_MS);
  };
  const worker = async () => {
    while (nextIndex < batch.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await parseOneFile(batch[index]);
      } catch {
        results[index] = null;
      }
      scheduleFlush();
    }
  };

  try {
    const workers = Math.min(PARSE_CONCURRENCY, batch.length);
    await Promise.all(Array.from({ length: workers }, worker));
  } finally {
    window.clearTimeout(timer);
    flush();
    endParse();
    scheduleOrganize();
  }
  return accepted;
}
