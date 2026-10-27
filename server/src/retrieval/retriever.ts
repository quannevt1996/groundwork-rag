import type { Db } from "../db/client.js";
import { toVectorLiteral } from "../db/client.js";
import type { Embedder } from "../embeddings/index.js";
import { reciprocalRankFusion } from "./rrf.js";

export type SearchMode = "vector" | "keyword" | "hybrid";

/**
 * How a keyword query matches chunks.
 * - "all": every term must appear. websearch_to_tsquery also gives users "quoted phrases",
 *   OR and -exclusions. Precise, but a question with one word the text doesn't use finds nothing.
 * - "any": the same stemmed terms OR-ed together, ranked by how often they occur. Finds far
 *   more, but Postgres ranking has no IDF, so common words weigh as much as rare identifiers.
 * The eval measures both; "all" makes the better hybrid partner (see README).
 */
export type KeywordMatch = "all" | "any";

const KEYWORD_QUERY: Record<KeywordMatch, string> = {
  all: "websearch_to_tsquery('english', $2)",
  // plainto_tsquery does the stemming and stop-word removal; turning its ANDs into ORs lets any term match.
  any: "replace(plainto_tsquery('english', $2)::text, ' & ', ' | ')::tsquery",
};

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  source: string;
  section: string;
  page: number | null;
  content: string;
  /** 1-based final position. */
  rank: number;
  fusedScore: number;
  vectorRank: number | null;
  vectorScore: number | null;
  keywordRank: number | null;
  keywordScore: number | null;
}

export interface SearchOptions {
  mode?: SearchMode;
  k?: number;
}

type ChunkRow = Pick<RetrievedChunk, "chunkId" | "documentId" | "documentTitle" | "source" | "section" | "page" | "content">;

interface Hit {
  id: string;
  score: number;
}

/** How deep each retriever looks before fusion. Deeper lists let RRF rescue items one retriever ranks low. */
const CANDIDATES = 30;

export class Retriever {
  constructor(
    private readonly db: Db,
    private readonly embedder: Embedder,
    private readonly keywordMatch: KeywordMatch = "all",
  ) {}

  async search(collectionId: string, query: string, { mode = "hybrid", k = 8 }: SearchOptions = {}): Promise<RetrievedChunk[]> {
    const [vectorHits, keywordHits] = await Promise.all([
      mode === "keyword" ? [] : this.vectorSearch(collectionId, query, CANDIDATES),
      mode === "vector" ? [] : this.keywordSearch(collectionId, query, CANDIDATES),
    ]);

    const fused = reciprocalRankFusion([vectorHits.map((h) => h.id), keywordHits.map((h) => h.id)]).slice(0, k);
    if (fused.length === 0) return [];

    const rows = await this.db.query<ChunkRow>(
      `SELECT c.id AS "chunkId", c.document_id AS "documentId", d.title AS "documentTitle", d.source,
              c.section, c.page, c.content
       FROM chunks c JOIN documents d ON d.id = c.document_id
       WHERE c.collection_id = $1 AND c.id = ANY($2::text[])`,
      [collectionId, fused.map((f) => f.id)],
    );
    const byId = new Map(rows.map((r) => [r.chunkId, r]));
    const position = (hits: Hit[], id: string) => {
      const i = hits.findIndex((h) => h.id === id);
      return i === -1 ? { rank: null, score: null } : { rank: i + 1, score: hits[i]!.score };
    };

    return fused.flatMap((f, i) => {
      const row = byId.get(f.id);
      if (!row) return [];
      const v = position(vectorHits, f.id);
      const kw = position(keywordHits, f.id);
      return [
        {
          ...row,
          rank: i + 1,
          fusedScore: f.score,
          vectorRank: v.rank,
          vectorScore: v.score,
          keywordRank: kw.rank,
          keywordScore: kw.score,
        },
      ];
    });
  }

  private async vectorSearch(collectionId: string, query: string, limit: number): Promise<Hit[]> {
    const embedding = toVectorLiteral(await this.embedder.embedQuery(query));
    // HNSW filters *after* the graph walk; iterative scans (pgvector >= 0.8) keep walking until
    // `limit` rows survive the collection filter instead of silently returning fewer.
    return this.db.transaction(async (tx) => {
      await tx.exec("SET LOCAL hnsw.iterative_scan = strict_order");
      return tx.query<Hit>(
        `SELECT id, 1 - (embedding <=> $2::vector) AS score
         FROM chunks WHERE collection_id = $1
         ORDER BY embedding <=> $2::vector LIMIT $3`,
        [collectionId, embedding, limit],
      );
    });
  }

  /**
   * ts_rank_cd ties are common (same terms, same counts). Chunk ids are random, so breaking
   * ties by id reordered results on every ingest; prefer the shorter (denser) chunk, then content.
   */
  private async keywordSearch(collectionId: string, query: string, limit: number): Promise<Hit[]> {
    return this.db.query<Hit>(
      `WITH query AS (SELECT ${KEYWORD_QUERY[this.keywordMatch]} AS q)
       SELECT id, ts_rank_cd(tsv, q) AS score
       FROM chunks, query
       WHERE collection_id = $1 AND tsv @@ q
       ORDER BY score DESC, length(content), content LIMIT $3`,
      [collectionId, query, limit],
    );
  }
}
