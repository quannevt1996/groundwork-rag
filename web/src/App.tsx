import { useCallback, useEffect, useRef, useState } from "react";
import { api, streamChat } from "./api";
import { Conversation } from "./components/Conversation";
import { Inspector, type SourceSelection } from "./components/Inspector";
import { Library } from "./components/Library";
import { applyEvent, newTurn, type Turn } from "./turns";
import type { Collection, Health, ResolvedCitation, SearchMode } from "./types";
import { useDocuments } from "./useDocuments";

const SAMPLE_COLLECTION = "Wayline samples";
const SAMPLE_QUESTIONS = [
  "How long do we keep database backups?",
  "What does error WL-4291 mean?",
  "Do I get time off if an alert wakes me up at night?",
  "Why did deliveries stall in March?",
];

let nextTurnId = 1;

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const { documents, error: documentsError, refresh: refreshDocuments } = useDocuments(collectionId);

  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [activeTurnId, setActiveTurnId] = useState<number | null>(null);
  const [selection, setSelection] = useState<SourceSelection | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<ResolvedCitation | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busy = turns.some((t) => t.status !== "done");

  const loadCollections = useCallback(async () => {
    const list = await api.collections();
    setCollections(list);
    return list;
  }, []);

  useEffect(() => {
    Promise.all([api.health(), loadCollections()])
      .then(([h, list]) => {
        setHealth(h);
        const preferred = list.find((c) => c.name === SAMPLE_COLLECTION) ?? list[0];
        if (preferred) setCollectionId(preferred.id);
      })
      .catch((err: Error) => setLoadError(`Can't reach the API (${err.message}). Is the server running?`));
  }, [loadCollections]);

  // Document counts in the collection picker follow uploads and deletes.
  const documentCount = documents.length;
  useEffect(() => {
    loadCollections().catch(() => undefined);
  }, [documentCount, loadCollections]);

  const resetConversation = () => {
    abortRef.current?.abort();
    setTurns([]);
    setConversationId(undefined);
    setActiveTurnId(null);
    setSelection(null);
    setSelectedCitation(null);
  };

  const selectCollection = (id: string) => {
    resetConversation();
    setCollectionId(id);
  };

  const createCollection = async (name: string) => {
    const created = await api.createCollection(name);
    await loadCollections();
    selectCollection(created.id);
  };

  const updateTurn = (id: number, update: (turn: Turn) => Turn) =>
    setTurns((all) => all.map((t) => (t.id === id ? update(t) : t)));

  const ask = async (question: string) => {
    if (!collectionId || busy) return;
    const id = nextTurnId++;
    setTurns((all) => [...all, newTurn(id, question, mode)]);
    setActiveTurnId(id);
    setSelection(null);
    setSelectedCitation(null);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat(
        collectionId,
        { message: question, conversationId, mode },
        (event) => {
          if (event.type === "conversation") setConversationId(event.conversationId);
          updateTurn(id, (t) => applyEvent(t, event));
        },
        controller.signal,
      );
    } catch (err) {
      const message = controller.signal.aborted ? "Stopped." : (err as Error).message;
      updateTurn(id, (t) => ({ ...t, error: message }));
    } finally {
      abortRef.current = null;
      updateTurn(id, (t) => (t.status === "done" ? t : { ...t, status: "done" }));
    }
  };

  const showCitation = (turn: Turn, citation: ResolvedCitation) => {
    const chunk = turn.results[citation.sourceIndex];
    if (!chunk) return;
    setActiveTurnId(turn.id);
    setSelectedCitation(citation);
    setSelection({ chunk, highlight: { start: citation.start, end: citation.end } });
  };

  const activeTurn = turns.find((t) => t.id === activeTurnId) ?? turns.at(-1) ?? null;
  const collection = collections?.find((c) => c.id === collectionId) ?? null;
  const hasReadyDocs = documents.some((d) => d.status === "ready");

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◆
          </span>
          <h1>Groundwork</h1>
          <span className="tagline">answers you can verify</span>
        </div>
        {health ? (
          <div className="status-pills">
            <span className="pill" title="Embedding model used for vector search">
              {health.embedder.id}
            </span>
            <span className="pill" title="Database">
              {health.database}
            </span>
            <span className={`pill ${health.llm.enabled ? "ok" : "off"}`} title="Model that writes answers">
              {health.llm.enabled ? health.llm.model : "answers off: no API key"}
            </span>
          </div>
        ) : null}
      </header>

      {loadError ? (
        <p className="flash error page-error">{loadError}</p>
      ) : collections === null ? (
        <p className="muted page-error">Loading…</p>
      ) : (
        <div className="layout">
          <Library
            collections={collections}
            collectionId={collectionId}
            onSelectCollection={selectCollection}
            onCreateCollection={createCollection}
            documents={documents}
            documentsError={documentsError}
            onDocumentsChanged={refreshDocuments}
          />
          <Conversation
            turns={turns}
            activeTurnId={activeTurn?.id ?? null}
            selectedCitation={selectedCitation}
            onSelectTurn={(id) => {
              setActiveTurnId(id);
              setSelection(null);
              setSelectedCitation(null);
            }}
            onCite={showCitation}
            onAsk={(q) => void ask(q)}
            onStop={() => abortRef.current?.abort()}
            onNewConversation={resetConversation}
            busy={busy}
            disabled={!collectionId || !hasReadyDocs}
            mode={mode}
            onModeChange={setMode}
            llmEnabled={health?.llm.enabled ?? false}
            suggestions={collection?.name === SAMPLE_COLLECTION && hasReadyDocs ? SAMPLE_QUESTIONS : []}
          />
          <Inspector
            collectionId={collectionId}
            keywordMatch={health?.retrieval.keywordMatch ?? "all"}
            turn={activeTurn}
            selection={selection}
            onSelect={(s) => {
              setSelection(s);
              setSelectedCitation(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
