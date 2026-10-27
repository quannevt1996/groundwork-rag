import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT_DIR } from "../config.js";
import type { IncomingFile } from "../ingest/service.js";

export const SAMPLES_DIR = path.join(ROOT_DIR, "samples");

const MIME_TYPES: Record<string, string> = {
  ".md": "text/markdown",
  ".html": "text/html",
  ".txt": "text/plain",
  ".pdf": "application/pdf",
};

/**
 * The sample corpus as upload-shaped files, in a stable order. samples/README.md
 * describes the corpus and is not part of it.
 */
export async function loadSampleFiles(dir = SAMPLES_DIR): Promise<IncomingFile[]> {
  const names = (await readdir(dir)).filter((name) => name !== "README.md" && MIME_TYPES[path.extname(name)]).sort();
  return Promise.all(
    names.map(async (name) => ({
      source: name,
      mimeType: MIME_TYPES[path.extname(name)]!,
      bytes: new Uint8Array(await readFile(path.join(dir, name))),
    })),
  );
}
