import type { LlmClient } from "../../src/answer/llm.js";
import { loadConfig, type Config } from "../../src/config.js";
import { openDb } from "../../src/db/client.js";
import { HashEmbedder } from "../../src/embeddings/index.js";
import { createServices, type Services } from "../../src/services.js";

/**
 * The real service graph over an in-memory PGlite database and the hash embedder:
 * real SQL, real migrations, no network. Config comes from an explicit env object,
 * so a developer's .env (or API key) never leaks into tests.
 */
export async function makeServices(
  opts: { llm?: LlmClient | null; env?: Record<string, string> } = {},
): Promise<Services> {
  const config: Config = loadConfig({ EMBEDDER: "hash", ...opts.env });
  const db = await openDb({});
  return createServices(config, db, new HashEmbedder(), opts.llm ?? null);
}

/** Ingests text files and waits for the background worker, returning the document ids by filename. */
export async function ingestFiles(
  services: Services,
  collectionId: string,
  files: Record<string, string>,
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const [name, text] of Object.entries(files)) {
    const { document } = await services.ingest.submit(collectionId, {
      source: name,
      mimeType: "",
      bytes: new TextEncoder().encode(text),
    });
    ids[name] = document.id;
  }
  await services.ingest.idle();
  return ids;
}

/** Three small docs with an identifier, overlapping vocabulary and a paraphrase target. */
export const FIXTURE_DOCS = {
  "runbook.md": `# Runbook

## Alerts

When WL-ALERT-QLAG fires, the delivery queue lag is above 120 seconds. Add delivery workers.

## After a night page

If you are paged between 22:00 and 07:00, take the next morning off.`,
  "retention.md": `# Retention policy

## Snapshots

Database snapshots are taken every 6 hours and kept for 35 days.

## Logs

Delivery logs are kept for 90 days.`,
  "api.md": `# API reference

## Rate limits

Requests above 600 per minute fail with error WL-4291 and a Retry-After header.`,
};
