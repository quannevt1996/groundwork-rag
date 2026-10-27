import { createHash } from "node:crypto";
import type { Db } from "../db/client.js";
import { toVectorLiteral } from "../db/client.js";
import type { Embedder } from "../embeddings/index.js";
import { newId } from "../ids.js";
import type { DocumentRecord, Store } from "../store.js";
import { chunkSections, DEFAULT_CHUNK_OPTIONS, type Chunk, type ChunkOptions } from "./chunker.js";
import { detectKind, parseDocument, type DocKind } from "./parse.js";

export interface IncomingFile {
  /** Filename or URL; used for type detection and as the fallback title. */
  source: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface SubmitResult {
  document: DocumentRecord;
  duplicate: boolean;
}

export class UnsupportedFileError extends Error {}

interface Job {
  documentId: string;
  kind: DocKind;
  file: IncomingFile;
}

/**
 * Accepts uploads synchronously (hash, dedupe, insert as `queued`) and does the slow
 * part — parse, chunk, embed, index — on a single in-process worker. One worker is
 * deliberate: local embedding is CPU-bound, so parallel jobs would only contend.
 */
export class IngestService {
  private readonly queue: Job[] = [];
  private running: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly embedder: Embedder,
    private readonly chunkOptions: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
  ) {}

  async submit(collectionId: string, file: IncomingFile): Promise<SubmitResult> {
    const kind = detectKind(file.source, file.mimeType);
    if (!kind) throw new UnsupportedFileError(`Unsupported file type: ${file.source} (${file.mimeType || "unknown"})`);

    const sha256 = createHash("sha256").update(file.bytes).digest("hex");
    const existing = await this.store.findDocumentByHash(collectionId, sha256);
    if (existing && existing.status !== "failed") return { document: existing, duplicate: true };

    let document: DocumentRecord;
    if (existing) {
      await this.store.setDocumentStatus(existing.id, "queued");
      document = (await this.store.getDocument(existing.id))!;
    } else {
      document = await this.store.insertDocument({
        collectionId,
        title: file.source,
        source: file.source,
        mimeType: file.mimeType || kind,
        sha256,
        byteSize: file.bytes.byteLength,
      });
    }

    this.queue.push({ documentId: document.id, kind, file });
    this.ensureWorker();
    return { document, duplicate: false };
  }

  /** Resolves once every queued job has finished. Used by tests, the seed script and the eval. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  /** Call only after pushing a job. The worker clears `running` in the same tick it sees an empty queue. */
  private ensureWorker(): void {
    if (this.running) return;
    this.running = (async () => {
      try {
        for (let job = this.queue.shift(); job; job = this.queue.shift()) await this.runJob(job);
      } finally {
        this.running = null;
      }
    })();
  }

  private async runJob(job: Job): Promise<void> {
    try {
      await this.process(job);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.store.setDocumentStatus(job.documentId, "failed", message).catch((e) => console.error(e));
    }
  }

  private async process({ documentId, kind, file }: Job): Promise<void> {
    await this.store.setDocumentStatus(documentId, "processing");

    const parsed = await parseDocument(file.bytes, kind, file.source);
    const chunks = chunkSections(parsed.sections, this.chunkOptions);
    if (chunks.length === 0) {
      throw new Error(kind === "pdf" ? "No extractable text (scanned PDFs need OCR, which isn't supported yet)." : "Document is empty.");
    }

    const embeddings = await this.embedder.embedDocuments(chunks.map((c) => embeddingText(parsed.title, c)));

    const doc = (await this.store.getDocument(documentId))!;
    await this.db.transaction(async (tx) => {
      await tx.query("DELETE FROM chunks WHERE document_id = $1", [documentId]);
      for (let start = 0; start < chunks.length; start += 100) {
        const batch = chunks.slice(start, start + 100);
        const params: unknown[] = [];
        const rows = batch.map((chunk, i) => {
          const ordinal = start + i;
          params.push(
            newId("chk"),
            documentId,
            doc.collectionId,
            ordinal,
            chunk.headings.join(" > "),
            chunk.page ?? null,
            chunk.content,
            chunk.tokenEstimate,
            toVectorLiteral(embeddings[ordinal]!),
          );
          const p = i * 9;
          return `($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8}, $${p + 9}::vector)`;
        });
        await tx.query(
          `INSERT INTO chunks (id, document_id, collection_id, ordinal, section, page, content, token_estimate, embedding)
           VALUES ${rows.join(", ")}`,
          params,
        );
      }
      await tx.query(
        `UPDATE documents SET status = 'ready', error = NULL, title = $2, chunk_count = $3, updated_at = now() WHERE id = $1`,
        [documentId, parsed.title, chunks.length],
      );
    });
  }
}

/**
 * What gets embedded is the chunk plus its document title and heading path
 * ("contextual chunk headers"), so a chunk that says "set it to 30s" still
 * lands near queries about the setting its heading names.
 */
export function embeddingText(title: string, chunk: Chunk): string {
  const path = chunk.headings[0] === title ? chunk.headings.slice(1) : chunk.headings;
  return [title, ...path].join(" > ") + "\n\n" + chunk.content;
}
