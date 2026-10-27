import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./client.js";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");

export interface EmbeddingSpec {
  id: string;
  dim: number;
}

/**
 * Applies pending SQL migrations in filename order, then pins the embedder the
 * database was built with. Re-opening a database with a different embedder fails
 * loudly instead of mixing incompatible vector spaces.
 */
export async function migrate(db: Db, embedding: EmbeddingSpec): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const applied = new Set(
    (await db.query<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name),
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = (await readFile(path.join(MIGRATIONS_DIR, file), "utf8")).replaceAll(
      "{{EMBEDDING_DIM}}",
      String(embedding.dim),
    );
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
  }

  const [pinned] = await db.query<{ embedder: string; dim: number }>(
    "SELECT embedder, dim FROM embedding_config WHERE id = 1",
  );
  if (!pinned) {
    await db.query("INSERT INTO embedding_config (id, embedder, dim) VALUES (1, $1, $2)", [embedding.id, embedding.dim]);
  } else if (pinned.embedder !== embedding.id || pinned.dim !== embedding.dim) {
    throw new Error(
      `This database was indexed with embedder "${pinned.embedder}" (${pinned.dim}d) but the server is configured ` +
        `for "${embedding.id}" (${embedding.dim}d). Use a fresh PGLITE_DATA_DIR / database, or switch EMBEDDER back.`,
    );
  }
}
