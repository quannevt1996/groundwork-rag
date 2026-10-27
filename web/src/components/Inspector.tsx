import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { citedChunkIds, type Turn } from "../turns";
import type { RetrievedChunk, SearchMode } from "../types";
import { ModeToggle } from "./ModeToggle";

/** What the source view shows: a chunk, optionally with the cited character span highlighted. */
export interface SourceSelection {
  chunk: RetrievedChunk;
  highlight: { start: number; end: number } | null;
}

interface Props {
  collectionId: string | null;
  keywordMatch: "all" | "any";
  turn: Turn | null;
  selection: SourceSelection | null;
  onSelect: (selection: SourceSelection | null) => void;
}

export function Inspector({ collectionId, keywordMatch, turn, selection, onSelect }: Props) {
  return (
    <aside className="inspector panel" aria-label="Retrieval inspector">
      {selection ? <SourceView selection={selection} onClose={() => onSelect(null)} /> : null}
      {turn ? (
        <RetrievedChunks
          key={turn.id}
          collectionId={collectionId}
          keywordMatch={keywordMatch}
          turn={turn}
          selection={selection}
          onSelect={onSelect}
        />
      ) : (
        <>
          <div className="panel-head">
            <h2>Retrieved chunks</h2>
          </div>
          <p className="muted small">
            Ask a question to see which chunks each retriever found, their ranks and scores, and how Reciprocal Rank
            Fusion combined them.
          </p>
        </>
      )}
    </aside>
  );
}

function SourceView({ selection, onClose }: { selection: SourceSelection; onClose: () => void }) {
  const { chunk, highlight } = selection;
  const markRef = useRef<HTMLElement>(null);
  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "nearest" });
  }, [selection]);

  const before = highlight ? chunk.content.slice(0, highlight.start) : chunk.content;
  const marked = highlight ? chunk.content.slice(highlight.start, highlight.end) : "";
  const after = highlight ? chunk.content.slice(highlight.end) : "";

  return (
    <section className="source" aria-label="Source passage">
      <div className="panel-head">
        <h2>{highlight ? "Cited passage" : "Chunk"}</h2>
        <button className="icon" onClick={onClose} aria-label="Close source">
          ×
        </button>
      </div>
      <p className="source-title">{chunk.documentTitle}</p>
      <p className="source-path">
        {[chunk.section, chunk.page ? `page ${chunk.page}` : null, chunk.source].filter(Boolean).join(" · ")}
      </p>
      <div className="source-text">
        {before}
        {highlight ? <mark ref={markRef}>{marked}</mark> : null}
        {after}
      </div>
    </section>
  );
}

/**
 * The chunks retrieved for one turn. Switching the mode here re-runs retrieval only
 * (no new answer), which makes it easy to compare what each retriever finds.
 */
function RetrievedChunks(props: Omit<Props, "turn"> & { turn: Turn }) {
  const { turn } = props;
  const [viewMode, setViewMode] = useState<SearchMode>(turn.mode);
  const [other, setOther] = useState<{ mode: SearchMode; results: RetrievedChunk[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = turn.standaloneQuery ?? turn.question;

  useEffect(() => {
    if (viewMode === turn.mode || !props.collectionId) return;
    let cancelled = false;
    setError(null);
    api
      .search(props.collectionId, query, viewMode, Math.max(turn.results.length, 8))
      .then((r) => !cancelled && setOther({ mode: viewMode, results: r.results }))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [viewMode, turn.mode, turn.results.length, query, props.collectionId]);

  const showingAnswerRetrieval = viewMode === turn.mode;
  const results = showingAnswerRetrieval ? turn.results : other?.mode === viewMode ? other.results : null;
  const cited = showingAnswerRetrieval ? citedChunkIds(turn) : new Set<string>();

  return (
    <section className="chunks">
      <div className="panel-head">
        <h2>Retrieved chunks</h2>
        <ModeToggle value={viewMode} onChange={setViewMode} label="Compare retrieval modes" />
      </div>
      <p className="muted small">
        {showingAnswerRetrieval
          ? `What the answer was grounded in (${turn.mode}).`
          : `What ${viewMode} retrieval finds for the same query. Not used for the answer.`}
      </p>
      {error ? <p className="flash error">{error}</p> : null}
      {results === null ? (
        <p className="muted small">{turn.status === "retrieving" ? "Searching…" : "Loading…"}</p>
      ) : results.length === 0 ? (
        <p className="muted small">
          No chunks matched.
          {viewMode === "keyword" && props.keywordMatch === "all"
            ? " Keyword search requires every term of the query to appear in a chunk."
            : ""}
        </p>
      ) : (
        <ol className="chunk-list">
          {results.map((chunk) => (
            <li key={chunk.chunkId}>
              <button
                className={`chunk${props.selection?.chunk.chunkId === chunk.chunkId ? " selected" : ""}`}
                onClick={() => props.onSelect({ chunk, highlight: null })}
              >
                <span className="chunk-head">
                  <span className="rank">{chunk.rank}</span>
                  <span className="chunk-title">{chunk.documentTitle}</span>
                  {cited.has(chunk.chunkId) ? <span className="badge">cited</span> : null}
                </span>
                {chunk.section || chunk.page ? (
                  <span className="chunk-path">{[chunk.section, chunk.page ? `page ${chunk.page}` : null].filter(Boolean).join(" · ")}</span>
                ) : null}
                <span className="chunk-preview">{chunk.content}</span>
                <span className="scores">
                  <Score label="fused" value={chunk.fusedScore.toFixed(4)} />
                  <Score label="vector" rank={chunk.vectorRank} value={chunk.vectorScore?.toFixed(3)} />
                  <Score label="keyword" rank={chunk.keywordRank} value={chunk.keywordScore?.toFixed(3)} />
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Score(props: { label: string; value: string | undefined; rank?: number | null }) {
  const missing = props.rank === null || props.value === undefined;
  return (
    <span className={`score${missing ? " missing" : ""}`} title={missing ? `Not in the ${props.label} results` : undefined}>
      {props.label} {missing ? "–" : `${props.rank !== undefined ? `#${props.rank} ` : ""}${props.value}`}
    </span>
  );
}
