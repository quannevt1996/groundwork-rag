import type { RetrievedChunk } from "../retrieval/retriever.js";
import type { BetaCitationSearchResultLocation } from "./llm.js";

export interface CitableBlock {
  text: string;
  /** Character offsets into the chunk's content. */
  start: number;
  end: number;
}

export interface ResolvedCitation {
  /** 0-based position of the cited chunk in this answer's retrieval results. */
  sourceIndex: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  section: string;
  page: number | null;
  citedText: string;
  /** Character range of the cited sentences inside the chunk, for highlighting. */
  start: number;
  end: number;
}

const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/g;
/** "1." or "b)" on its own is a list or heading number ("1. Purpose and scope"), not a sentence. */
const ENUMERATOR = /^(\d{1,3}|[a-zA-Z])[.)]$/;

/**
 * Claude cites whole content blocks, never substrings, so sentence-sized blocks give
 * sentence-precise citations. Offsets are kept so the UI can highlight the exact span.
 */
export function citableBlocks(content: string): CitableBlock[] {
  const blocks: CitableBlock[] = [];
  for (const line of content.matchAll(/[^\n]+/g)) {
    let cursor = 0;
    const text = line[0];
    const pieces = [...text.matchAll(SENTENCE_BREAK)].map((m) => m.index!);
    for (const breakAt of [...pieces, text.length]) {
      const raw = text.slice(cursor, breakAt);
      if (breakAt < text.length && ENUMERATOR.test(raw.trim())) continue; // keep the number with its text
      const lead = raw.length - raw.trimStart().length;
      const piece = raw.trim();
      if (piece) blocks.push({ text: piece, start: line.index! + cursor + lead, end: line.index! + cursor + lead + piece.length });
      cursor = breakAt;
    }
  }
  return blocks;
}

export function resolveCitation(
  citation: BetaCitationSearchResultLocation,
  sources: RetrievedChunk[],
  blocks: CitableBlock[][],
): ResolvedCitation | null {
  const chunk = sources[citation.search_result_index];
  const chunkBlocks = blocks[citation.search_result_index];
  const first = chunkBlocks?.[citation.start_block_index];
  const last = chunkBlocks?.[citation.end_block_index - 1];
  if (!chunk || !first || !last) return null;
  return {
    sourceIndex: citation.search_result_index,
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    documentTitle: chunk.documentTitle,
    section: chunk.section,
    page: chunk.page,
    citedText: citation.cited_text,
    start: first.start,
    end: last.end,
  };
}
