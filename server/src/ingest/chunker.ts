import type { Section } from "./parse.js";

export interface ChunkOptions {
  /** Upper bound on chunk length in characters (~4 chars per token for English). */
  maxChars: number;
  /** How much trailing context from the previous chunk to repeat, in characters. */
  overlapChars: number;
}

export interface Chunk {
  headings: string[];
  page?: number;
  content: string;
  tokenEstimate: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxChars: 1200, overlapChars: 200 };

/**
 * Structure-aware chunking: sections (heading boundaries, PDF pages) are never
 * merged, so every chunk has exactly one heading path and page. Inside a section,
 * paragraphs are packed up to `maxChars`; oversize paragraphs fall back to
 * sentences, then words. Consecutive chunks of a section overlap by whole sentences.
 */
export function chunkSections(sections: Section[], opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS): Chunk[] {
  return sections.flatMap((section) =>
    packUnits(toUnits(section.text, opts.maxChars), opts).map((content) => ({
      headings: section.headings,
      page: section.page,
      content,
      tokenEstimate: Math.ceil(content.length / 4),
    })),
  );
}

function packUnits(units: string[], opts: ChunkOptions): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;

  for (const unit of units) {
    const added = length === 0 ? unit.length : unit.length + 2;
    if (length > 0 && length + added > opts.maxChars) {
      const finished = current.join("\n\n");
      chunks.push(finished);
      current = overlapTail(finished, opts.overlapChars, opts.maxChars - unit.length - 2);
      length = current.join("\n\n").length;
    }
    current.push(unit);
    length += length === 0 ? unit.length : unit.length + 2;
  }
  if (current.length) chunks.push(current.join("\n\n"));
  return chunks;
}

/** Whole trailing sentences of `text`, at most `overlapChars` long and never so long the next unit won't fit. */
function overlapTail(text: string, overlapChars: number, room: number): string[] {
  const budget = Math.min(overlapChars, room);
  if (budget <= 0) return [];
  const sentences = splitSentences(text);
  let tail = "";
  for (let i = sentences.length - 1; i >= 0; i--) {
    const candidate = tail ? `${sentences[i]} ${tail}` : sentences[i]!;
    if (candidate.length > budget) break;
    tail = candidate;
  }
  return tail ? [tail] : [];
}

/** Paragraph blocks (code fences kept whole), each guaranteed to be at most `maxChars`. */
function toUnits(text: string, maxChars: number): string[] {
  return splitBlocks(text).flatMap((block) => {
    if (block.length <= maxChars) return [block];
    return splitSentences(block).flatMap((s) => (s.length <= maxChars ? [s] : splitWords(s, maxChars)));
  });
}

function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "") {
      if (current.length) blocks.push(current.join("\n").trim());
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join("\n").trim());
  return blocks.filter(Boolean);
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitWords(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).flatMap((w) => (w.length > maxChars ? (w.match(new RegExp(`.{1,${maxChars}}`, "g")) ?? []) : [w]));
  const pieces: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && current.length + word.length + 1 > maxChars) {
      pieces.push(current);
      current = "";
    }
    current = current ? `${current} ${word}` : word;
  }
  if (current) pieces.push(current);
  return pieces;
}
