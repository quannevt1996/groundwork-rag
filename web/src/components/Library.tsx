import { useState, type DragEvent, type FormEvent } from "react";
import { api } from "../api";
import type { Collection, DocumentRecord } from "../types";

const ACCEPT = ".md,.markdown,.txt,.html,.htm,.pdf";

interface Props {
  collections: Collection[];
  collectionId: string | null;
  onSelectCollection: (id: string) => void;
  onCreateCollection: (name: string) => Promise<void>;
  documents: DocumentRecord[];
  documentsError: string | null;
  onDocumentsChanged: () => void;
}

export function Library(props: Props) {
  const { collections, collectionId, documents } = props;
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(collections.length === 0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);

  const upload = async (files: File[]) => {
    if (!collectionId || files.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const results = await api.upload(collectionId, files);
      const duplicates = results.filter((r) => r.duplicate).length;
      const added = results.length - duplicates;
      setMessage({
        kind: "info",
        text: `Added ${added} file${added === 1 ? "" : "s"}${duplicates ? `, skipped ${duplicates} already in this collection` : ""}.`,
      });
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
      props.onDocumentsChanged();
    }
  };

  const remove = async (doc: DocumentRecord) => {
    if (!window.confirm(`Delete "${doc.title}" and its ${doc.chunkCount} chunks?`)) return;
    try {
      await api.deleteDocument(doc.id);
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    }
    props.onDocumentsChanged();
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await props.onCreateCollection(newName.trim());
    setNewName("");
    setCreating(false);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void upload([...e.dataTransfer.files]);
  };

  return (
    <aside className="library panel" aria-label="Document library">
      <div className="panel-head">
        <h2>Library</h2>
        <button className="link" onClick={() => setCreating((c) => !c)}>
          {creating ? "Cancel" : "New collection"}
        </button>
      </div>

      {creating ? (
        <form className="new-collection" onSubmit={create}>
          <input
            autoFocus
            placeholder="Collection name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            aria-label="Collection name"
          />
          <button type="submit" disabled={!newName.trim()}>
            Create
          </button>
        </form>
      ) : null}

      {collections.length > 0 ? (
        <select
          className="collection-select"
          value={collectionId ?? ""}
          onChange={(e) => props.onSelectCollection(e.target.value)}
          aria-label="Collection"
        >
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.documentCount})
            </option>
          ))}
        </select>
      ) : null}

      {collectionId ? (
        <>
          <label
            className={`dropzone${dragging ? " dragging" : ""}${busy ? " busy" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              type="file"
              multiple
              accept={ACCEPT}
              disabled={busy}
              onChange={(e) => {
                void upload([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
            <strong>{busy ? "Uploading…" : "Upload documents"}</strong>
            <span>Drop or choose Markdown, text, HTML or PDF files</span>
          </label>

          {message ? <p className={`flash ${message.kind}`}>{message.text}</p> : null}
          {props.documentsError ? <p className="flash error">{props.documentsError}</p> : null}

          {documents.length === 0 ? (
            <p className="muted small">
              No documents yet. Upload some, or run <code>npm run seed</code> to load the sample corpus.
            </p>
          ) : (
            <ul className="doc-list">
              {documents.map((doc) => (
                <li key={doc.id} className="doc">
                  <div className="doc-main">
                    <span className="doc-title" title={doc.source}>
                      {doc.title}
                    </span>
                    <span className="doc-meta">
                      <span className={`status ${doc.status}`}>{doc.status}</span>
                      {doc.status === "ready" ? `${doc.chunkCount} chunks · ` : ""}
                      {formatBytes(doc.byteSize)}
                    </span>
                    {doc.error ? <span className="doc-error">{doc.error}</span> : null}
                  </div>
                  <button className="icon" onClick={() => void remove(doc)} aria-label={`Delete ${doc.title}`} title="Delete">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </aside>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
