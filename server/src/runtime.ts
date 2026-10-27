import { createAnthropicClient } from "./answer/llm.js";
import type { Config } from "./config.js";
import { openDb } from "./db/client.js";
import { createEmbedder } from "./embeddings/index.js";
import { createServices, type Services } from "./services.js";

/** Production wiring: real database, configured embedder, real Claude client when a key is present. */
export async function bootstrap(config: Config): Promise<Services> {
  const embedder = await createEmbedder(config);
  const db = await openDb({ databaseUrl: config.DATABASE_URL, dataDir: config.PGLITE_DATA_DIR });
  return createServices(config, db, embedder, config.llmEnabled ? createAnthropicClient() : null);
}
