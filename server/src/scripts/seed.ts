/**
 * Ingests samples/ into the configured database (PGlite in data/ by default) so the
 * app has something to search on first run. Safe to re-run: uploads dedupe by content
 * hash, so unchanged files are skipped.
 *
 * PGlite allows one process per data directory, so stop the server before seeding.
 */
import { loadConfig } from "../config.js";
import { bootstrap } from "../runtime.js";
import { loadSampleFiles, SAMPLES_DIR } from "./samples.js";

const COLLECTION_NAME = "Wayline samples";

const config = loadConfig();
if (config.EMBEDDER === "local") console.log(`Loading ${config.LOCAL_EMBEDDING_MODEL} (downloaded once on first run)...`);
const services = await bootstrap(config);
const { store, ingest } = services;

try {
  const collection =
    (await store.listCollections()).find((c) => c.name === COLLECTION_NAME) ??
    (await store.createCollection(COLLECTION_NAME, "Fictional engineering docs from the samples/ folder"));

  const files = await loadSampleFiles();
  console.log(`Ingesting ${files.length} files from ${SAMPLES_DIR} with ${services.embedder.id}...`);
  let skipped = 0;
  for (const file of files) {
    const { duplicate } = await ingest.submit(collection.id, file);
    if (duplicate) skipped++;
  }
  await ingest.idle();

  const docs = await store.listDocuments(collection.id);
  for (const doc of [...docs].sort((a, b) => a.source.localeCompare(b.source))) {
    const detail = doc.status === "ready" ? `${doc.chunkCount} chunks` : (doc.error ?? "");
    console.log(`  ${doc.status.padEnd(6)} ${doc.source.padEnd(30)} ${detail}`);
  }
  const failed = docs.filter((d) => d.status === "failed").length;
  console.log(
    `Collection "${collection.name}" (${collection.id}): ${docs.length} documents, ` +
      `${skipped} already present, ${failed} failed.`,
  );
  if (failed > 0) process.exitCode = 1;
} finally {
  await services.db.close();
}
