import { existsSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { loadConfig, ROOT_DIR } from "./config.js";
import { bootstrap } from "./runtime.js";

const config = loadConfig();
if (config.EMBEDDER === "local") console.log(`Loading ${config.LOCAL_EMBEDDING_MODEL} (downloaded once on first run)...`);
const services = await bootstrap(config);
const app = createApp(services);

// In production the API also serves the built web app, so one process is the whole product.
const webDist = path.join(ROOT_DIR, "web", "dist");
if (existsSync(webDist)) {
  const root = path.relative(process.cwd(), webDist);
  app.use("/*", serveStatic({ root }));
  app.get("*", serveStatic({ root, path: "index.html" }));
}

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`Groundwork API on http://localhost:${info.port}`);
  console.log(`  database: ${services.db.kind}${config.DATABASE_URL ? "" : ` (${config.PGLITE_DATA_DIR})`}`);
  console.log(`  embedder: ${services.embedder.id} (${services.embedder.dim}d)`);
  console.log(`  answers:  ${config.llmEnabled ? config.ANTHROPIC_MODEL : "disabled (set ANTHROPIC_API_KEY)"}`);
});

const shutdown = async () => {
  server.close();
  await services.ingest.idle();
  await services.db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
