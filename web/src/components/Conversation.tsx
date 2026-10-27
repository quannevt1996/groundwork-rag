import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { distinctCitations, type Turn } from "../turns";
import type { ResolvedCitation, SearchMode } from "../types";
import { ModeToggle } from "./ModeToggle";

interface Props {
  turns: Turn[];
  activeTurnId: number | null;
  selectedCitation: ResolvedCitation | null;
  onSelectTurn: (id: number) => void;
  onCite: (turn: Turn, citation: ResolvedCitation) => void;
  onAsk: (question: string) => void;
  onStop: () => void;
  onNewConversation: () => void;
  busy: boolean;
  disabled: boolean;
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
  llmEnabled: boolean;
  suggestions: string[];
}

export function Conversation(props: Props) {
  const { turns, busy } = props;
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const last = turns.at(-1);

  // Keep the newest text in view while it streams.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, last?.segments.length, last?.status]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const question = draft.trim();
    if (!question || busy || props.disabled) return;
    props.onAsk(question);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) submit(e);
  };

  return (
    <main className="conversation panel" aria-label="Conversation">
      <div className="panel-head">
        <h2>Ask your documents</h2>
        {turns.length > 0 ? (
          <button className="link" onClick={props.onNewConversation} disabled={busy}>
            New conversation
          </button>
        ) : null}
      </div>

      {!props.llmEnabled ? (
        <p className="banner">
          <strong>Retrieval-only mode.</strong> No <code>ANTHROPIC_API_KEY</code> is set, so questions return the
          passages an answer would cite, ranked and scored, but no written answer.
        </p>
      ) : null}

      <div className="turns">
        {turns.length === 0 ? (
          <div className="empty">
            <p className="muted">Answers cite the exact sentences they rely on. Click a citation to see it in context.</p>
            {props.suggestions.length > 0 ? (
              <div className="suggestions">
                {props.suggestions.map((s) => (
                  <button key={s} className="chip" onClick={() => props.onAsk(s)} disabled={busy || props.disabled}>
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          turns.map((turn) => (
            <TurnView
              key={turn.id}
              turn={turn}
              active={turn.id === props.activeTurnId}
              selectedCitation={props.selectedCitation}
              onSelect={() => props.onSelectTurn(turn.id)}
              onCite={(c) => props.onCite(turn, c)}
            />
          ))
        )}
        <div ref={endRef} />
      </div>

      <form className="ask" onSubmit={submit}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={props.disabled ? "Add a document to start asking questions" : "Ask a question (Enter to send, Shift+Enter for a new line)"}
          rows={2}
          disabled={props.disabled}
          aria-label="Question"
        />
        <div className="ask-row">
          <ModeToggle value={props.mode} onChange={props.onModeChange} label="Retrieval" />
          {busy ? (
            <button type="button" className="secondary" onClick={props.onStop}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!draft.trim() || props.disabled}>
              {props.llmEnabled ? "Ask" : "Retrieve"}
            </button>
          )}
        </div>
      </form>
    </main>
  );
}

function TurnView(props: {
  turn: Turn;
  active: boolean;
  selectedCitation: ResolvedCitation | null;
  onSelect: () => void;
  onCite: (citation: ResolvedCitation) => void;
}) {
  const { turn } = props;
  const streaming = turn.status !== "done";
  const hasAnswer = turn.segments.some((s) => s.text.trim());

  return (
    <article className={`turn${props.active ? " active" : ""}`} onClick={props.onSelect}>
      <p className="question">{turn.question}</p>
      {turn.standaloneQuery ? <p className="rewrite">Searched for “{turn.standaloneQuery}”</p> : null}

      {hasAnswer ? (
        <div className="answer">
          {turn.segments.map((segment, i) => (
            <span key={i}>
              {segment.text}
              {distinctCitations(segment).map((c) => (
                <button
                  key={`${c.sourceIndex}:${c.start}`}
                  className={`cite${isSame(c, props.selectedCitation) ? " selected" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onCite(c);
                  }}
                  title={`${c.documentTitle}${c.section ? ` › ${c.section}` : ""}: “${c.citedText}”`}
                >
                  {c.sourceIndex + 1}
                </button>
              ))}
            </span>
          ))}
          {streaming ? <span className="caret" aria-hidden /> : null}
        </div>
      ) : streaming ? (
        <p className="muted">{turn.status === "retrieving" ? "Searching…" : "Writing an answer…"}</p>
      ) : null}

      {turn.notices.map((n) => (
        <p key={n.code} className={`notice ${n.level}`}>
          {n.message}
        </p>
      ))}
      {turn.error ? <p className="notice error">{turn.error}</p> : null}

      {turn.status === "done" ? (
        <p className="turn-meta">
          {turn.mode} retrieval · {turn.results.length} passages{turn.model ? ` · ${turn.model}` : ""}
        </p>
      ) : null}
    </article>
  );
}

const isSame = (a: ResolvedCitation, b: ResolvedCitation | null) =>
  b !== null && a.chunkId === b.chunkId && a.start === b.start && a.end === b.end;
