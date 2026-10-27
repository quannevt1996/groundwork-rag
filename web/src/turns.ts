import type { AnswerEvent, ResolvedCitation, RetrievedChunk, SearchMode } from "./types";

export interface Segment {
  text: string;
  citations: ResolvedCitation[];
}

export interface Notice {
  level: "info" | "warning";
  code: string;
  message: string;
}

/** One question and everything the server streamed back for it. */
export interface Turn {
  id: number;
  question: string;
  mode: SearchMode;
  /** Set when a follow-up was rewritten into a standalone search query. */
  standaloneQuery: string | null;
  results: RetrievedChunk[];
  segments: Segment[];
  notices: Notice[];
  error: string | null;
  status: "retrieving" | "answering" | "done";
  model: string | null;
}

export function newTurn(id: number, question: string, mode: SearchMode): Turn {
  return {
    id,
    question,
    mode,
    standaloneQuery: null,
    results: [],
    segments: [],
    notices: [],
    error: null,
    status: "retrieving",
    model: null,
  };
}

/** Folds one server event into a turn. Pure, so React state updates stay simple. */
export function applyEvent(turn: Turn, event: AnswerEvent): Turn {
  switch (event.type) {
    case "conversation":
      return turn;
    case "query":
      return { ...turn, standaloneQuery: event.standalone };
    case "retrieval":
      return { ...turn, results: event.results, status: "answering" };
    case "segment":
      return { ...turn, segments: [...turn.segments, { text: "", citations: [] }] };
    case "text":
      return updateLastSegment(turn, (s) => ({ ...s, text: s.text + event.delta }));
    case "citation":
      return updateLastSegment(turn, (s) => ({ ...s, citations: [...s.citations, event.citation] }));
    case "notice":
      return { ...turn, notices: [...turn.notices, { level: event.level, code: event.code, message: event.message }] };
    case "done":
      return { ...turn, status: "done", model: event.model ?? null };
    case "error":
      return { ...turn, status: "done", error: event.message };
  }
}

function updateLastSegment(turn: Turn, update: (segment: Segment) => Segment): Turn {
  const segments = turn.segments.length ? [...turn.segments] : [{ text: "", citations: [] }];
  segments[segments.length - 1] = update(segments[segments.length - 1]!);
  return { ...turn, segments };
}

/** Chunk ids this turn's answer cites, for marking them in the retrieved list. */
export function citedChunkIds(turn: Turn): Set<string> {
  return new Set(turn.segments.flatMap((s) => s.citations.map((c) => c.chunkId)));
}

/** One marker per distinct cited span within a segment, in citation order. */
export function distinctCitations(segment: Segment): ResolvedCitation[] {
  const seen = new Set<string>();
  return segment.citations.filter((c) => {
    const key = `${c.sourceIndex}:${c.start}:${c.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
