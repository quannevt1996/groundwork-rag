import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import type { Services } from "../src/services.js";
import { FIXTURE_DOCS, makeServices } from "./helpers/services.js";

let services: Services;
let app: Hono;

beforeAll(async () => {
  services = await makeServices();
  app = createApp(services);
});
afterAll(() => services.db.close());

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function createCollection(name = "Docs"): Promise<string> {
  const res = await app.request("/api/collections", json("POST", { name }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function upload(collectionId: string, files: Record<string, string>, type = "text/markdown") {
  const form = new FormData();
  for (const [name, text] of Object.entries(files)) form.append("file", new File([text], name, { type }));
  return app.request(`/api/collections/${collectionId}/documents`, { method: "POST", body: form });
}

/** Parses an SSE body into [event, data] pairs. */
async function readSse(res: Response): Promise<{ event: string; data: Record<string, unknown> }[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((block) => block.trim())
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((l) => l.startsWith("event: "))!.slice(7);
      const data = JSON.parse(lines.find((l) => l.startsWith("data: "))!.slice(6));
      return { event, data };
    });
}

describe("HTTP API", () => {
  it("GET /api/health reports the database, embedder and whether answers are enabled", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      database: "pglite",
      embedder: { id: "hash:384", dim: 384 },
      llm: { enabled: false, model: "claude-opus-5-5" },
      retrieval: { topK: 8, keywordMatch: "all" },
    });
  });

  it("creates and lists collections, validating input", async () => {
    expect((await app.request("/api/collections", json("POST", { name: "  " }))).status).toBe(400);
    const id = await createCollection("Handbook");
    const list = (await (await app.request("/api/collections")).json()) as { id: string; name: string }[];
    expect(list).toContainEqual(expect.objectContaining({ id, name: "Handbook", documentCount: 0, chunkCount: 0 }));
  });

  it("uploads files, processes them in the background, and dedupes re-uploads", async () => {
    const id = await createCollection();
    const res = await upload(id, FIXTURE_DOCS);
    expect(res.status).toBe(202);
    const accepted = (await res.json()) as { duplicate: boolean; document: { status: string } }[];
    expect(accepted).toHaveLength(3);
    expect(accepted.every((r) => !r.duplicate && r.document.status === "queued")).toBe(true);

    await services.ingest.idle();
    const docs = (await (await app.request(`/api/collections/${id}/documents`)).json()) as {
      title: string;
      status: string;
      chunkCount: number;
    }[];
    expect(docs.map((d) => d.status)).toEqual(["ready", "ready", "ready"]);
    expect(docs.map((d) => d.title).sort()).toEqual(["API reference", "Retention policy", "Runbook"]);
    expect(docs.every((d) => d.chunkCount > 0)).toBe(true);

    const again = (await (await upload(id, { "copy.md": FIXTURE_DOCS["api.md"] })).json()) as { duplicate: boolean }[];
    expect(again[0]!.duplicate).toBe(true);
  });

  it("rejects uploads it cannot parse or that carry no file", async () => {
    const id = await createCollection();
    const res = await upload(id, { "photo.png": "not really a png" }, "image/png");
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "Unsupported file type: photo.png (image/png)" });
    const empty = await app.request(`/api/collections/${id}/documents`, { method: "POST", body: new FormData() });
    expect(empty.status).toBe(400);
  });

  it("searches a collection in each mode", async () => {
    const id = await createCollection();
    await upload(id, FIXTURE_DOCS);
    await services.ingest.idle();

    for (const mode of ["vector", "keyword", "hybrid"]) {
      const res = await app.request(`/api/collections/${id}/search`, json("POST", { query: "WL-4291", mode, k: 3 }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { mode: string; results: { content: string }[] };
      expect(body.mode).toBe(mode);
      expect(body.results.length).toBeGreaterThan(0);
      expect(body.results.length).toBeLessThanOrEqual(3);
    }
    const bad = await app.request(`/api/collections/${id}/search`, json("POST", { query: "x", mode: "fuzzy" }));
    expect(bad.status).toBe(400);
  });

  it("streams a chat turn as server-sent events and stores the conversation", async () => {
    const id = await createCollection();
    await upload(id, FIXTURE_DOCS);
    await services.ingest.idle();

    const res = await app.request(`/api/collections/${id}/chat`, json("POST", { message: "WL-4291", mode: "keyword" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = await readSse(res);
    expect(events.map((e) => e.event)).toEqual(["conversation", "retrieval", "notice", "done"]);
    expect(events[2]!.data).toMatchObject({ code: "llm_disabled" });

    const conversationId = events[0]!.data.conversationId as string;
    const conversations = (await (await app.request(`/api/collections/${id}/conversations`)).json()) as { id: string }[];
    expect(conversations.map((c) => c.id)).toContain(conversationId);
    const messages = (await (await app.request(`/api/conversations/${conversationId}/messages`)).json()) as {
      role: string;
      content: string;
    }[];
    expect(messages).toEqual([expect.objectContaining({ role: "user", content: "WL-4291" })]);
  });

  it("refuses to continue a conversation from another collection", async () => {
    const a = await createCollection("A");
    const b = await createCollection("B");
    const first = await readSse(await app.request(`/api/collections/${a}/chat`, json("POST", { message: "hello" })));
    const conversationId = first[0]!.data.conversationId;
    const res = await app.request(`/api/collections/${b}/chat`, json("POST", { message: "again", conversationId }));
    expect(res.status).toBe(404);
  });

  it("deletes documents and collections", async () => {
    const id = await createCollection();
    const [accepted] = (await (await upload(id, { "one.md": "# One\n\nSome text." })).json()) as { document: { id: string } }[];
    await services.ingest.idle();
    const docId = accepted!.document.id;

    expect((await app.request(`/api/documents/${docId}`)).status).toBe(200);
    expect((await app.request(`/api/documents/${docId}`, { method: "DELETE" })).status).toBe(204);
    expect((await app.request(`/api/documents/${docId}`)).status).toBe(404);
    expect((await app.request(`/api/documents/${docId}`, { method: "DELETE" })).status).toBe(404);

    expect((await app.request(`/api/collections/${id}`, { method: "DELETE" })).status).toBe(204);
    expect((await app.request(`/api/collections/${id}/documents`)).status).toBe(404);
  });

  it("returns JSON errors for unknown collections and malformed bodies", async () => {
    const missing = await app.request("/api/collections/col_missing/search", json("POST", { query: "x" }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Collection not found" });

    const malformed = await app.request("/api/collections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(malformed.status).toBe(400);
  });
});
