import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HashEmbedder } from "../src/embeddings/index.js";
import { Retriever } from "../src/retrieval/retriever.js";
import type { Services } from "../src/services.js";
import { FIXTURE_DOCS, ingestFiles, makeServices } from "./helpers/services.js";

let services: Services;
let collectionId: string;
let otherCollectionId: string;

beforeAll(async () => {
  services = await makeServices();
  collectionId = (await services.store.createCollection("main")).id;
  otherCollectionId = (await services.store.createCollection("other")).id;
  await ingestFiles(services, collectionId, FIXTURE_DOCS);
  await ingestFiles(services, otherCollectionId, {
    "other.md": "# Other\n\nError WL-4291 also appears in another collection, which must never leak into results.",
  });
});

afterAll(() => services.db.close());

describe("Retriever", () => {
  it("keyword mode finds an exact identifier and reports only keyword ranks", async () => {
    const results = await services.retriever.search(collectionId, "WL-4291", { mode: "keyword" });
    expect(results[0]!.content).toContain("WL-4291");
    expect(results[0]!.section).toBe("API reference > Rate limits");
    for (const r of results) {
      expect(r.keywordRank).not.toBeNull();
      expect(r.vectorRank).toBeNull();
      expect(r.vectorScore).toBeNull();
    }
  });

  it("keyword mode requires every term by default", async () => {
    // "retained" appears in no document, so an all-terms query matches nothing.
    expect(await services.retriever.search(collectionId, "how long are snapshots retained", { mode: "keyword" })).toEqual([]);
  });

  it("keyword mode with match=any finds chunks that share some of the terms", async () => {
    const anyTerms = new Retriever(services.db, services.embedder, "any");
    const results = await anyTerms.search(collectionId, "how long are snapshots retained", { mode: "keyword" });
    expect(results[0]!.content).toContain("Database snapshots");
  });

  it("vector mode ranks by cosine similarity and reports only vector scores", async () => {
    const results = await services.retriever.search(collectionId, "database snapshots kept", { mode: "vector", k: 5 });
    expect(results).toHaveLength(5);
    expect(results[0]!.content).toContain("Database snapshots");
    for (const r of results) expect(r.keywordRank).toBeNull();
    const scores = results.map((r) => r.vectorScore!);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("hybrid mode fuses both lists, keeps both ranks and orders by fused score", async () => {
    const results = await services.retriever.search(collectionId, "WL-4291 Retry-After", { mode: "hybrid", k: 4 });
    expect(results.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(results[0]!.content).toContain("WL-4291");
    expect(results[0]!.vectorRank).not.toBeNull();
    expect(results[0]!.keywordRank).not.toBeNull();
    const fused = results.map((r) => r.fusedScore);
    expect(fused).toEqual([...fused].sort((a, b) => b - a));
  });

  it("returns chunk metadata needed for citations", async () => {
    const [top] = await services.retriever.search(collectionId, "WL-ALERT-QLAG", { mode: "keyword" });
    expect(top).toMatchObject({ documentTitle: "Runbook", source: "runbook.md", section: "Runbook > Alerts", page: null });
    expect(top!.chunkId).toMatch(/^chk_/);
    expect(top!.documentId).toMatch(/^doc_/);
  });

  it("never returns chunks from another collection", async () => {
    for (const mode of ["vector", "keyword", "hybrid"] as const) {
      const results = await services.retriever.search(collectionId, "WL-4291 another collection", { mode, k: 30 });
      expect(results.every((r) => r.source !== "other.md")).toBe(true);
    }
  });

  it("respects k and returns nothing for an empty collection", async () => {
    expect(await services.retriever.search(collectionId, "delivery", { mode: "vector", k: 2 })).toHaveLength(2);
    const empty = (await services.store.createCollection("empty")).id;
    expect(await services.retriever.search(empty, "delivery")).toEqual([]);
  });

  it("refuses to open a database indexed with a different embedder", async () => {
    const { migrate } = await import("../src/db/migrate.js");
    await expect(migrate(services.db, new HashEmbedder(128))).rejects.toThrow(/indexed with embedder "hash:384"/);
  });
});
