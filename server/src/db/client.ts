import { PGlite, type Transaction } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import pg from "pg";

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs one or more statements without parameters (used for migrations). */
  exec(sql: string): Promise<void>;
}

/**
 * The one database seam in the app. Both implementations speak the same SQL,
 * so the embedded (PGlite) and server (Postgres + pgvector) modes share every query.
 */
export interface Db extends Queryable {
  readonly kind: "pglite" | "postgres";
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface OpenDbOptions {
  /** postgres:// URL. When absent, an embedded PGlite database is used. */
  databaseUrl?: string;
  /** PGlite data directory; omit for an in-memory database. */
  dataDir?: string;
}

export async function openDb(opts: OpenDbOptions): Promise<Db> {
  return opts.databaseUrl ? openPostgres(opts.databaseUrl) : openPglite(opts.dataDir);
}

async function openPglite(dataDir?: string): Promise<Db> {
  const db = await PGlite.create(dataDir, { extensions: { vector } });
  const wrap = (q: PGlite | Transaction): Queryable => ({
    async query<T>(sql: string, params?: unknown[]) {
      return (await q.query<T>(sql, params)).rows;
    },
    async exec(sql) {
      await q.exec(sql);
    },
  });
  return {
    kind: "pglite",
    ...wrap(db),
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
    close: () => db.close(),
  };
}

async function openPostgres(url: string): Promise<Db> {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  await pool.query("select 1");
  return {
    kind: "postgres",
    async query<T>(sql: string, params?: unknown[]) {
      return (await pool.query(sql, params)).rows as T[];
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          query: async <T>(sql: string, params?: unknown[]) => (await client.query(sql, params)).rows as T[],
          exec: async (sql) => void (await client.query(sql)),
        });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** pgvector accepts the text form `[x,y,...]`, which keeps both drivers on plain string params. */
export function toVectorLiteral(v: ArrayLike<number>): string {
  return `[${Array.from(v).join(",")}]`;
}
