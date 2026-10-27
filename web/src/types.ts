// Shapes returned by the API. These mirror server/src (store.ts, retrieval/retriever.ts,
// answer/citations.ts, answer/answerer.ts); keep them in sync when the API changes.

export type SearchMode = "hybrid" | "vector" | "keyword";

export interface Health {
  ok: boolean;
  database: "pglite" | "postgres";
  embedder: { id: string; dim: number };
  llm: { enabled: boolean; model: string };
  retrieval: { topK: number; keywordMatch: "all" | "any" };
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  documentCount: number;
  chunkCount: number;
}

export type DocStatus = "queued" | "processing" | "ready" | "failed";

export interface DocumentRecord {
  id: string;
  collectionId: string;
  title: string;
  source: string;
  mimeType: string;
  byteSize: number;
  status: DocStatus;
  error: string | null;
  chunkCount: number;
  createdAt: string;
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  source: string;
  section: string;
  page: number | null;
  content: string;
  rank: number;
  fusedScore: number;
  vectorRank: number | null;
  vectorScore: number | null;
  keywordRank: number | null;
  keywordScore: number | null;
}

export interface ResolvedCitation {
  sourceIndex: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  section: string;
  page: number | null;
  citedText: string;
  start: number;
  end: number;
}

export type AnswerEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "query"; standalone: string }
  | { type: "retrieval"; results: RetrievedChunk[] }
  | { type: "segment" }
  | { type: "text"; delta: string }
  | { type: "citation"; citation: ResolvedCitation }
  | { type: "notice"; level: "info" | "warning"; code: string; message: string }
  | { type: "done"; messageId: string | null; model?: string; usage?: { inputTokens: number; outputTokens: number } }
  | { type: "error"; message: string };
