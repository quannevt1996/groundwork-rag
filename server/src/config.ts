import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Repo root, resolved the same way from `src/` (tsx) and `dist/` (node). */
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const rootEnv = path.join(ROOT_DIR, ".env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.string().optional(),
  PGLITE_DATA_DIR: z.string().default(path.join(ROOT_DIR, "data", "pglite")),

  EMBEDDER: z.enum(["local", "voyage", "hash"]).default("local"),
  LOCAL_EMBEDDING_MODEL: z.string().default("Xenova/bge-small-en-v1.5"),
  MODEL_CACHE_DIR: z.string().default(path.join(ROOT_DIR, ".cache", "models")),
  VOYAGE_API_KEY: z.string().optional(),
  VOYAGE_MODEL: z.string().default("voyage-3.5-lite"),
  EMBEDDING_DIM: z.coerce.number().int().positive().optional(),

  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),

  RETRIEVAL_TOP_K: z.coerce.number().int().min(1).max(30).default(8),
  /** Below this cosine similarity, and with no keyword hit, we answer "not found" without calling the model. */
  MIN_VECTOR_SIMILARITY: z.coerce.number().min(-1).max(1).default(0.55),
});

export type Config = z.infer<typeof EnvSchema> & { llmEnabled: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  return {
    ...parsed,
    // The SDK also accepts ANTHROPIC_AUTH_TOKEN; either one means we can call Claude.
    llmEnabled: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
  };
}
