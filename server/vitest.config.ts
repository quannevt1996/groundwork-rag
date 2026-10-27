import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Each suite boots an in-memory Postgres (PGlite + pgvector); allow for slow machines.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
