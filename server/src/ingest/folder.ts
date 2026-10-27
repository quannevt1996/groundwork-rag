import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Services } from "../services.js";
import type { Collection, DocumentRecord } from "../store.js";
import { UnsupportedFileError } from "./service.js";

/** Extensions the parser understands, and the MIME type recorded for each. */
const MIME_TYPES: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".pdf": "application/pdf",
  ".html": "text/html",
  ".htm": "text/html",
};

/** HTML in a code folder is mostly generated (coverage reports, build output), so it is opt-in. */
export const DEFAULT_EXTENSIONS = [".md", ".markdown", ".txt", ".pdf"];

/** Directories that hold dependencies, build output or tool state rather than documents. */
const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage", "vendor", "target", "tmp"]);

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Queued jobs hold file bytes in memory until processed, so large folders are submitted in batches. */
const BATCH_SIZE = 100;

export interface FolderFile {
  /** Path relative to the folder, with forward slashes. Becomes the document's source. */
  source: string;
  absolutePath: string;
  mimeType: string;
}

export interface FolderScan {
  files: FolderFile[];
  /** Supported files left out because they are larger than the limit. */
  tooLarge: string[];
}

/**
 * Lists the documents under `root` worth indexing, sorted by path. Hidden directories
 * (.git, .next, .cache, ...) and SKIPPED_DIRS are not entered, and symlinks are not
 * followed, so a checkout's dependencies and build output never reach the index.
 */
export async function scanFolder(
  root: string,
  extensions: string[] = DEFAULT_EXTENSIONS,
  maxBytes = MAX_FILE_BYTES,
): Promise<FolderScan> {
  const wanted = new Set(extensions.map((e) => (e.startsWith(".") ? e : `.${e}`).toLowerCase()));
  const files: FolderFile[] = [];
  const tooLarge: string[] = [];

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !SKIPPED_DIRS.has(entry.name)) await walk(absolutePath);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      const mimeType = MIME_TYPES[ext];
      if (!entry.isFile() || !mimeType || !wanted.has(ext)) continue;
      const source = path.relative(root, absolutePath).split(path.sep).join("/");
      if ((await stat(absolutePath)).size > maxBytes) tooLarge.push(source);
      else files.push({ source, absolutePath, mimeType });
    }
  }

  await walk(root);
  files.sort((a, b) => a.source.localeCompare(b.source));
  return { files, tooLarge: tooLarge.sort((a, b) => a.localeCompare(b)) };
}

export interface FolderIngestResult {
  collection: Collection;
  found: number;
  tooLarge: string[];
  /** Counts for this run. */
  added: number;
  duplicates: number;
  unsupported: number;
  /** Older versions removed because the file at the same path changed. */
  replaced: number;
  /** State of the whole collection after the run. */
  documents: DocumentRecord[];
  failed: DocumentRecord[];
  chunks: number;
}

/**
 * Indexes a folder into the named collection, creating it if needed. Re-running is
 * cheap: files whose content is already in the collection are skipped, which also
 * collapses identical copies of a document across several checkouts. A file whose
 * content changed replaces its older version, once the new one has indexed.
 */
export async function ingestFolder(
  { store, ingest }: Pick<Services, "store" | "ingest">,
  root: string,
  opts: { collectionName: string; extensions?: string[]; onProgress?: (submitted: number, total: number) => void },
): Promise<FolderIngestResult> {
  const { files, tooLarge } = await scanFolder(root, opts.extensions);
  const collection =
    (await store.listCollections()).find((c) => c.name === opts.collectionName) ??
    (await store.createCollection(opts.collectionName, `Indexed from ${root}`));

  const previous = await store.listDocuments(collection.id);
  let added = 0;
  let duplicates = 0;
  let unsupported = 0;
  let replaced = 0;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    // New document id -> ids of older documents indexed from the same path.
    const updates = new Map<string, string[]>();
    for (const file of files.slice(i, i + BATCH_SIZE)) {
      const bytes = new Uint8Array(await readFile(file.absolutePath));
      try {
        const { document, duplicate } = await ingest.submit(collection.id, { source: file.source, mimeType: file.mimeType, bytes });
        if (duplicate) {
          duplicates++;
          continue;
        }
        added++;
        const older = previous.filter((d) => d.source === file.source && d.id !== document.id).map((d) => d.id);
        if (older.length > 0) updates.set(document.id, older);
      } catch (err) {
        if (!(err instanceof UnsupportedFileError)) throw err;
        unsupported++;
      }
    }
    await ingest.idle();

    // Drop an old version only once its replacement is searchable, so a failed parse never loses content.
    for (const [newId, olderIds] of updates) {
      if ((await store.getDocument(newId))?.status !== "ready") continue;
      for (const id of olderIds) if (await store.deleteDocument(id)) replaced++;
    }
    opts.onProgress?.(Math.min(i + BATCH_SIZE, files.length), files.length);
  }

  const documents = await store.listDocuments(collection.id);
  return {
    collection,
    found: files.length,
    tooLarge,
    added,
    duplicates,
    unsupported,
    replaced,
    documents,
    failed: documents.filter((d) => d.status === "failed"),
    chunks: documents.reduce((sum, d) => sum + d.chunkCount, 0),
  };
}
