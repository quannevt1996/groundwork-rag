import type { Config } from "../config.js";
import type { Embedder } from "./embedder.js";
import { HashEmbedder } from "./hash.js";
import { LocalEmbedder } from "./local.js";
import { VoyageEmbedder } from "./voyage.js";

export type { Embedder } from "./embedder.js";
export { HashEmbedder } from "./hash.js";

export async function createEmbedder(config: Config): Promise<Embedder> {
  switch (config.EMBEDDER) {
    case "hash":
      return new HashEmbedder(config.EMBEDDING_DIM);
    case "voyage":
      if (!config.VOYAGE_API_KEY) throw new Error("EMBEDDER=voyage requires VOYAGE_API_KEY");
      return new VoyageEmbedder(config.VOYAGE_API_KEY, config.VOYAGE_MODEL, config.EMBEDDING_DIM ?? 1024);
    case "local":
      return LocalEmbedder.load(config.LOCAL_EMBEDDING_MODEL, config.MODEL_CACHE_DIR);
  }
}
