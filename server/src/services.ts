import { Answerer } from "./answer/answerer.js";
import type { LlmClient } from "./answer/llm.js";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import type { Embedder } from "./embeddings/index.js";
import { IngestService } from "./ingest/service.js";
import { Retriever } from "./retrieval/retriever.js";
import { Store } from "./store.js";

export interface Services {
  config: Config;
  db: Db;
  embedder: Embedder;
  llm: LlmClient | null;
  store: Store;
  ingest: IngestService;
  retriever: Retriever;
  answerer: Answerer;
}

/** Wires the app from its three external dependencies, so tests can swap any of them. */
export async function createServices(config: Config, db: Db, embedder: Embedder, llm: LlmClient | null): Promise<Services> {
  await migrate(db, embedder);
  const store = new Store(db);
  const interrupted = await store.failInterruptedDocuments();
  if (interrupted > 0) console.warn(`Marked ${interrupted} interrupted ingestion job(s) as failed.`);
  const retriever = new Retriever(db, embedder, config.KEYWORD_MATCH);
  return {
    config,
    db,
    embedder,
    llm,
    store,
    ingest: new IngestService(db, store, embedder),
    retriever,
    answerer: new Answerer(store, retriever, llm, config),
  };
}
