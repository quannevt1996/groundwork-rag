import type { Db } from "./db/client.js";
import { newId } from "./ids.js";

export type DocStatus = "queued" | "processing" | "ready" | "failed";

export interface Collection {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  documentCount: number;
  chunkCount: number;
}

export interface DocumentRecord {
  id: string;
  collectionId: string;
  title: string;
  source: string;
  mimeType: string;
  sha256: string;
  byteSize: number;
  status: DocStatus;
  error: string | null;
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Conversation {
  id: string;
  collectionId: string;
  title: string;
  createdAt: Date;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  segments: unknown;
  retrieval: unknown;
  createdAt: Date;
}

const DOC_COLUMNS = `id, collection_id AS "collectionId", title, source, mime_type AS "mimeType", sha256,
  byte_size AS "byteSize", status, error, chunk_count AS "chunkCount", created_at AS "createdAt", updated_at AS "updatedAt"`;

/** Thin, typed SQL for the non-retrieval tables. Every read is scoped by its parent id. */
export class Store {
  constructor(private readonly db: Db) {}

  async listCollections(): Promise<Collection[]> {
    return this.db.query<Collection>(
      `SELECT c.id, c.name, c.description, c.created_at AS "createdAt",
        (SELECT count(*)::int FROM documents d WHERE d.collection_id = c.id) AS "documentCount",
        (SELECT count(*)::int FROM chunks k WHERE k.collection_id = c.id) AS "chunkCount"
       FROM collections c ORDER BY c.created_at`,
    );
  }

  async getCollection(id: string): Promise<Collection | undefined> {
    return (await this.listCollections()).find((c) => c.id === id);
  }

  async createCollection(name: string, description = ""): Promise<Collection> {
    const id = newId("col");
    await this.db.query("INSERT INTO collections (id, name, description) VALUES ($1, $2, $3)", [id, name, description]);
    return (await this.getCollection(id))!;
  }

  async deleteCollection(id: string): Promise<boolean> {
    return (await this.db.query("DELETE FROM collections WHERE id = $1 RETURNING id", [id])).length > 0;
  }

  async listDocuments(collectionId: string): Promise<DocumentRecord[]> {
    return this.db.query<DocumentRecord>(
      `SELECT ${DOC_COLUMNS} FROM documents WHERE collection_id = $1 ORDER BY created_at DESC`,
      [collectionId],
    );
  }

  async getDocument(id: string): Promise<DocumentRecord | undefined> {
    const [doc] = await this.db.query<DocumentRecord>(`SELECT ${DOC_COLUMNS} FROM documents WHERE id = $1`, [id]);
    return doc;
  }

  async findDocumentByHash(collectionId: string, sha256: string): Promise<DocumentRecord | undefined> {
    const [doc] = await this.db.query<DocumentRecord>(
      `SELECT ${DOC_COLUMNS} FROM documents WHERE collection_id = $1 AND sha256 = $2`,
      [collectionId, sha256],
    );
    return doc;
  }

  async insertDocument(doc: Pick<DocumentRecord, "collectionId" | "title" | "source" | "mimeType" | "sha256" | "byteSize">) {
    const id = newId("doc");
    await this.db.query(
      `INSERT INTO documents (id, collection_id, title, source, mime_type, sha256, byte_size, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued')`,
      [id, doc.collectionId, doc.title, doc.source, doc.mimeType, doc.sha256, doc.byteSize],
    );
    return (await this.getDocument(id))!;
  }

  async setDocumentStatus(id: string, status: DocStatus, error: string | null = null): Promise<void> {
    await this.db.query("UPDATE documents SET status = $2, error = $3, updated_at = now() WHERE id = $1", [id, status, error]);
  }

  async deleteDocument(id: string): Promise<boolean> {
    return (await this.db.query("DELETE FROM documents WHERE id = $1 RETURNING id", [id])).length > 0;
  }

  /** Jobs live in memory, so anything mid-flight when the process died will never finish. */
  async failInterruptedDocuments(): Promise<number> {
    const rows = await this.db.query(
      `UPDATE documents SET status = 'failed', error = 'Interrupted by a server restart. Upload the file again to retry.',
         updated_at = now()
       WHERE status IN ('queued', 'processing') RETURNING id`,
    );
    return rows.length;
  }

  async createConversation(collectionId: string, title: string): Promise<Conversation> {
    const id = newId("cnv");
    const [row] = await this.db.query<Conversation>(
      `INSERT INTO conversations (id, collection_id, title) VALUES ($1, $2, $3)
       RETURNING id, collection_id AS "collectionId", title, created_at AS "createdAt"`,
      [id, collectionId, title],
    );
    return row!;
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    const [row] = await this.db.query<Conversation>(
      `SELECT id, collection_id AS "collectionId", title, created_at AS "createdAt" FROM conversations WHERE id = $1`,
      [id],
    );
    return row;
  }

  async listConversations(collectionId: string): Promise<Conversation[]> {
    return this.db.query<Conversation>(
      `SELECT id, collection_id AS "collectionId", title, created_at AS "createdAt"
       FROM conversations WHERE collection_id = $1 ORDER BY created_at DESC`,
      [collectionId],
    );
  }

  async listMessages(conversationId: string): Promise<StoredMessage[]> {
    return this.db.query<StoredMessage>(
      `SELECT id, conversation_id AS "conversationId", role, content, segments, retrieval, created_at AS "createdAt"
       FROM messages WHERE conversation_id = $1 ORDER BY created_at, id`,
      [conversationId],
    );
  }

  async addMessage(
    msg: Pick<StoredMessage, "conversationId" | "role" | "content"> & { segments?: unknown; retrieval?: unknown },
  ): Promise<string> {
    const id = newId("msg");
    await this.db.query(
      `INSERT INTO messages (id, conversation_id, role, content, segments, retrieval) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        msg.conversationId,
        msg.role,
        msg.content,
        msg.segments === undefined ? null : JSON.stringify(msg.segments),
        msg.retrieval === undefined ? null : JSON.stringify(msg.retrieval),
      ],
    );
    return id;
  }
}
