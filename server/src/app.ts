import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { z, ZodError } from "zod";
import { ConversationNotFoundError } from "./answer/answerer.js";
import { UnsupportedFileError, type IncomingFile } from "./ingest/service.js";
import type { Services } from "./services.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const CreateCollection = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
});
const IngestUrl = z.object({ url: z.url({ protocol: /^https?$/ }) });
const Mode = z.enum(["vector", "keyword", "hybrid"]).default("hybrid");
const Search = z.object({
  query: z.string().trim().min(1).max(2000),
  mode: Mode,
  k: z.number().int().min(1).max(30).default(8),
});
const Chat = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().optional(),
  mode: Mode,
});

export function createApp(services: Services): Hono {
  const { config, store, ingest, retriever, answerer, embedder, db } = services;
  const api = new Hono();

  const requireCollection = async (c: Context) => {
    const collection = await store.getCollection(c.req.param("collectionId")!);
    if (!collection) throw new HTTPException(404, { message: "Collection not found" });
    return collection;
  };

  api.get("/health", (c) =>
    c.json({
      ok: true,
      database: db.kind,
      embedder: { id: embedder.id, dim: embedder.dim },
      llm: { enabled: config.llmEnabled, model: config.ANTHROPIC_MODEL },
    }),
  );

  api.get("/collections", async (c) => c.json(await store.listCollections()));

  api.post("/collections", async (c) => {
    const body = CreateCollection.parse(await c.req.json());
    return c.json(await store.createCollection(body.name, body.description), 201);
  });

  api.delete("/collections/:collectionId", async (c) => {
    if (!(await store.deleteCollection(c.req.param("collectionId")))) throw new HTTPException(404, { message: "Collection not found" });
    return c.body(null, 204);
  });

  api.get("/collections/:collectionId/documents", async (c) => {
    const collection = await requireCollection(c);
    return c.json(await store.listDocuments(collection.id));
  });

  api.post("/collections/:collectionId/documents", bodyLimit({ maxSize: MAX_UPLOAD_BYTES }), async (c) => {
    const collection = await requireCollection(c);
    const form = await c.req.parseBody({ all: true });
    const files = [form.file].flat().filter((f): f is File => f instanceof File);
    if (files.length === 0) throw new HTTPException(400, { message: 'Attach one or more files in the "file" field' });

    const results = [];
    for (const file of files) {
      const incoming: IncomingFile = { source: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
      results.push(await ingest.submit(collection.id, incoming));
    }
    return c.json(results, 202);
  });

  api.post("/collections/:collectionId/documents/url", async (c) => {
    const collection = await requireCollection(c);
    const { url } = IngestUrl.parse(await c.req.json());
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "follow" }).catch((err: Error) => {
      throw new HTTPException(502, { message: `Couldn't fetch ${url}: ${err.message}` });
    });
    if (!res.ok) throw new HTTPException(502, { message: `Fetching ${url} returned ${res.status}` });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new HTTPException(413, { message: "Page is larger than 25 MB" });
    const result = await ingest.submit(collection.id, {
      source: url,
      mimeType: res.headers.get("content-type") ?? "",
      bytes,
    });
    return c.json(result, 202);
  });

  api.get("/documents/:documentId", async (c) => {
    const doc = await store.getDocument(c.req.param("documentId"));
    if (!doc) throw new HTTPException(404, { message: "Document not found" });
    return c.json(doc);
  });

  api.delete("/documents/:documentId", async (c) => {
    if (!(await store.deleteDocument(c.req.param("documentId")))) throw new HTTPException(404, { message: "Document not found" });
    return c.body(null, 204);
  });

  api.post("/collections/:collectionId/search", async (c) => {
    const collection = await requireCollection(c);
    const { query, mode, k } = Search.parse(await c.req.json());
    return c.json({ query, mode, results: await retriever.search(collection.id, query, { mode, k }) });
  });

  api.get("/collections/:collectionId/conversations", async (c) => {
    const collection = await requireCollection(c);
    return c.json(await store.listConversations(collection.id));
  });

  api.get("/conversations/:conversationId/messages", async (c) => {
    const conversation = await store.getConversation(c.req.param("conversationId"));
    if (!conversation) throw new HTTPException(404, { message: "Conversation not found" });
    return c.json(await store.listMessages(conversation.id));
  });

  api.post("/collections/:collectionId/chat", async (c) => {
    const collection = await requireCollection(c);
    const input = Chat.parse(await c.req.json());
    if (input.conversationId) {
      const conversation = await store.getConversation(input.conversationId);
      if (conversation?.collectionId !== collection.id) throw new HTTPException(404, { message: "Conversation not found" });
    }
    const abort = new AbortController();
    return streamSSE(c, async (stream) => {
      stream.onAbort(() => abort.abort());
      try {
        for await (const event of answerer.answer(collection.id, input, abort.signal)) {
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        }
      } catch (err) {
        console.error(err);
        const message = err instanceof ConversationNotFoundError ? "Conversation not found" : "Something went wrong while answering.";
        await stream.writeSSE({ event: "error", data: JSON.stringify({ type: "error", message }) });
      }
    });
  });

  const app = new Hono();
  app.route("/api", api);
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof ZodError) return c.json({ error: "Invalid request", issues: err.issues }, 400);
    if (err instanceof SyntaxError) return c.json({ error: "Malformed JSON body" }, 400);
    if (err instanceof UnsupportedFileError) return c.json({ error: err.message }, 415);
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  });
  return app;
}
