import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ingestFolder, scanFolder } from "../src/ingest/folder.js";
import { makeServices } from "./helpers/services.js";

let root: string;

async function put(relative: string, text: string): Promise<void> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "groundwork-folder-"));
  await put("README.md", "# Payments service\n\nRetries use exponential backoff capped at 30 seconds.");
  await put("docs/runbook.txt", "Page the on-call engineer when the queue lag passes five minutes.");
  await put("docs/report.html", "<h1>Coverage</h1><p>Generated.</p>");
  await put("docs/diagram.png", "not a document");
  await put("node_modules/lib/README.md", "# A dependency");
  await put(".git/notes.md", "# Git internals");
  await put("dist/README.md", "# Build output");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("scanFolder", () => {
  it("lists supported documents by relative path and skips dependency, build and hidden folders", async () => {
    const { files } = await scanFolder(root);
    expect(files.map((f) => f.source)).toEqual(["docs/runbook.txt", "README.md"]);
    expect(files[1]).toMatchObject({ mimeType: "text/markdown", absolutePath: path.join(root, "README.md") });
  });

  it("includes HTML only when asked", async () => {
    const { files } = await scanFolder(root, ["md", ".html"]);
    expect(files.map((f) => f.source)).toEqual(["docs/report.html", "README.md"]);
  });

  it("reports files over the size limit instead of reading them", async () => {
    const { files, tooLarge } = await scanFolder(root, undefined, 60);
    expect(tooLarge).toEqual(["docs/runbook.txt", "README.md"]);
    expect(files).toEqual([]);
  });
});

describe("ingestFolder", () => {
  it("indexes a folder into a new collection, and a re-run adds nothing", async () => {
    const services = await makeServices();
    try {
      const first = await ingestFolder(services, root, { collectionName: "payments" });
      expect(first).toMatchObject({ found: 2, added: 2, duplicates: 0, failed: [] });
      expect(first.documents.map((d) => d.status)).toEqual(["ready", "ready"]);
      expect(first.chunks).toBeGreaterThanOrEqual(2);

      const again = await ingestFolder(services, root, { collectionName: "payments" });
      expect(again).toMatchObject({ added: 0, duplicates: 2 });
      expect(again.collection.id).toBe(first.collection.id);
      expect(await services.store.listCollections()).toHaveLength(1);
    } finally {
      await services.db.close();
    }
  });

  it("replaces the older version of a file whose content changed", async () => {
    const services = await makeServices();
    try {
      await ingestFolder(services, root, { collectionName: "payments" });
      await put("README.md", "# Payments service\n\nRetries use linear backoff capped at 10 seconds.");

      const rerun = await ingestFolder(services, root, { collectionName: "payments" });
      expect(rerun).toMatchObject({ added: 1, duplicates: 1, replaced: 1 });
      expect(rerun.documents.map((d) => d.source).sort()).toEqual(["docs/runbook.txt", "README.md"].sort());

      const id = rerun.collection.id;
      expect(await services.retriever.search(id, "linear backoff", { mode: "keyword" })).toHaveLength(1);
      expect(await services.retriever.search(id, "exponential backoff", { mode: "keyword" })).toHaveLength(0);
    } finally {
      await services.db.close();
    }
  });

  it("keeps the older version when the new one fails to index", async () => {
    const services = await makeServices();
    try {
      const first = await ingestFolder(services, root, { collectionName: "payments", extensions: ["md"] });
      await put("README.md", "");

      const rerun = await ingestFolder(services, root, { collectionName: "payments", extensions: ["md"] });
      expect(rerun).toMatchObject({ added: 1, replaced: 0 });
      expect(rerun.failed.map((d) => d.source)).toEqual(["README.md"]);
      expect(rerun.documents.find((d) => d.id === first.documents[0]!.id)?.status).toBe("ready");
    } finally {
      await services.db.close();
    }
  });

  it("indexes a document copied into several checkouts once", async () => {
    await put("worktree-b/README.md", "# Payments service\n\nRetries use exponential backoff capped at 30 seconds.");
    const services = await makeServices();
    try {
      const result = await ingestFolder(services, root, { collectionName: "work" });
      expect(result).toMatchObject({ found: 3, added: 2, duplicates: 1 });
      expect(result.documents).toHaveLength(2);

      const hits = await services.retriever.search(result.collection.id, "exponential backoff", { mode: "keyword", k: 5 });
      expect(hits).toHaveLength(1);
    } finally {
      await services.db.close();
    }
  });
});
