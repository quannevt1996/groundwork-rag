/**
 * Indexes a folder of your own documents into a collection:
 *
 *   npm run ingest -- ~/notes                                   # collection named after the folder
 *   npm run ingest -- ~/work/specs --collection "Specs" --ext md,pdf,html
 *
 * Parsing, chunking and embedding all run locally, so indexing sends nothing off the
 * machine. Safe to re-run: unchanged files are skipped by content hash, and a changed
 * file replaces its older version.
 *
 * PGlite allows one process per data directory, so stop the server first.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.js";
import { DEFAULT_EXTENSIONS, ingestFolder, MAX_FILE_BYTES } from "../ingest/folder.js";
import { bootstrap } from "../runtime.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { collection: { type: "string" }, ext: { type: "string" } },
});
if (positionals.length !== 1) {
  console.error('Usage: npm run ingest -- <folder> [--collection "Name"] [--ext md,pdf,txt,html]');
  process.exit(1);
}

// npm runs workspace scripts from server/, so resolve against the directory the command was typed in.
const root = path.resolve(process.env.INIT_CWD ?? process.cwd(), positionals[0]!);
const extensions = values.ext ? values.ext.split(",").map((e) => e.trim()).filter(Boolean) : DEFAULT_EXTENSIONS;
const collectionName = values.collection ?? path.basename(root);

const config = loadConfig();
if (config.EMBEDDER === "local") console.log(`Loading ${config.LOCAL_EMBEDDING_MODEL} (downloaded once on first run)...`);
const services = await bootstrap(config);

try {
  console.log(`Indexing ${extensions.join(", ")} files under ${root} into "${collectionName}"...`);
  const result = await ingestFolder(services, root, {
    collectionName,
    extensions,
    onProgress: (submitted, total) => console.log(`  ${submitted}/${total}`),
  });

  if (result.tooLarge.length > 0) {
    console.log(`Skipped ${result.tooLarge.length} files over ${MAX_FILE_BYTES / 1024 / 1024} MB, e.g. ${result.tooLarge[0]}`);
  }
  for (const doc of result.failed.slice(0, 20)) console.log(`  failed  ${doc.source}: ${doc.error}`);
  console.log(
    `Found ${result.found} files: ${result.added} indexed, ${result.duplicates} already present` +
      `${result.replaced ? `, ${result.replaced} older versions replaced` : ""}` +
      `${result.unsupported ? `, ${result.unsupported} unsupported` : ""}.`,
  );
  console.log(
    `Collection "${result.collection.name}" now has ${result.documents.length} documents and ` +
      `${result.chunks} chunks (${result.failed.length} failed).`,
  );
  if (result.failed.length > 0) process.exitCode = 1;
} finally {
  await services.db.close();
}
