
const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "are",
  "was",
  "were",
  "have",
  "has",
  "been",
  "not",
  "but",
  "you",
  "your",
  "our",
  "into",
  "onto",
  "about",
  "over",
  "after",
  "before",
  "page",
]);

export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function headingOf(text: string): string | undefined {
  return text.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
}

function firstLine(text: string): string {
  return (
    text
      .split(/\n/)
      .map((l) => l.replace(/^#+\s*/, "").trim())
      .find((l) => l.length > 0) ?? ""
  );
}

/**
 * Section key. One significant word from the heading/first line, so
 * "Pricing for teams" and "Pricing seats" land in the same section instead of
 * fragmenting into near-duplicate topics.
 */
export function topicKey(text: string, sourceName: string): string {
  const heading = headingOf(text);
  const seed = heading || firstLine(text);
  const words = wordsOf(seed);
  if (words.length >= 1) return words[0];
  const stem = sourceName
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return stem || "note";
}

function shortPhrase(line: string, max = 48) {
  const cleaned = line.replace(/\s+/g, " ").trim();
  const head =
    cleaned.split(/\s+[—–−]\s+|\s+·\s+| • |\s+From:|\s+\d{1,2}:\d{2}/)[0]?.trim() || cleaned;
  const phrase = head.length >= 8 ? head : cleaned;
  if (phrase.length <= max) return phrase;
  const sliced = phrase.slice(0, max);
  return sliced.replace(/\s+\S*$/, "").trimEnd() || sliced;
}

export function clipTitle(text: string, sourceName: string, suffix?: string): string {
  const heading = headingOf(text);
  const line = heading || firstLine(text) || sourceName.replace(/\.[^.]+$/, "");
  const base = shortPhrase(line, heading ? 72 : 48);
  return suffix ? `${base} · ${suffix}` : base;
}

/** Wall face only. Inspector still uses the stored title. */
export function cardFaceTitle(title: string) {
  return shortPhrase(title, 32);
}

/**
 * Card excerpt: the body WITHOUT the line that became the title, so a card
 * never reads "Launch / Launch Short copy only…".
 */
export function clipExcerpt(text: string, title?: string): string {
  const lines = text.split(/\n/).map((line) => line.replace(/^#+\s*/, "").trim());
  const rest = lines.filter((line) => line.length > 0);
  const normalizedTitle = title?.replace(/\s+/g, " ").trim().toLowerCase();
  if (rest.length > 1 && normalizedTitle && rest[0].toLowerCase().startsWith(normalizedTitle.slice(0, 40))) {
    rest.shift();
  }
  let joined = rest.join(" ").replace(/\s+/g, " ").trim();
  if (normalizedTitle && joined.toLowerCase().startsWith(normalizedTitle)) {
    // Whatever follows the title is the excerpt; nothing left means no excerpt.
    joined = joined.slice(normalizedTitle.length).replace(/^[\s.:,;-]+/, "");
    if (joined.length < 12) joined = "";
  }
  return joined.slice(0, 180);
}

/** Significant words for cross-card linking: longer, non-stop words, deduped. */
export function keywordsOf(text: string, limit = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const word of wordsOf(text)) {
    if (word.length < 4 || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= limit) break;
  }
  return out;
}

export function prettySource(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || name;
}

export function topicHue(topic: string): number {
  let hash = 2166136261;
  for (let i = 0; i < topic.length; i++) {
    hash ^= topic.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 360;
}
