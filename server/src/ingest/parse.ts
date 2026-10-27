import path from "node:path";
import TurndownService from "turndown";
import { extractText, getDocumentProxy } from "unpdf";

export interface Section {
  /** Heading path from the outermost heading down, e.g. ["Runbook", "Paging", "Escalation"]. */
  headings: string[];
  text: string;
  /** 1-based page number, PDFs only. */
  page?: number;
}

export interface ParsedDocument {
  title: string;
  sections: Section[];
}

export type DocKind = "pdf" | "markdown" | "html" | "text";

const EXTENSIONS: Record<string, DocKind> = {
  ".pdf": "pdf",
  ".md": "markdown",
  ".markdown": "markdown",
  ".html": "html",
  ".htm": "html",
  ".txt": "text",
};

export function detectKind(filename: string, mimeType: string): DocKind | null {
  const mime = mimeType.split(";")[0]!.trim().toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/markdown") return "markdown";
  if (mime === "text/html") return "html";
  const byExt = EXTENSIONS[path.extname(filename.split(/[?#]/)[0]!).toLowerCase()];
  if (byExt) return byExt;
  return mime === "text/plain" ? "text" : null;
}

export async function parseDocument(bytes: Uint8Array, kind: DocKind, filename: string): Promise<ParsedDocument> {
  const fallbackTitle = titleFromFilename(filename);
  switch (kind) {
    case "pdf":
      return parsePdf(bytes, fallbackTitle);
    case "markdown":
      return parseMarkdown(decode(bytes), fallbackTitle);
    case "html":
      return parseHtml(decode(bytes), fallbackTitle);
    case "text":
      return { title: fallbackTitle, sections: [{ headings: [], text: decode(bytes).trim() }] };
  }
}

/** Splits markdown into sections at headings, ignoring `#` lines inside fenced code blocks. */
export function parseMarkdown(markdown: string, fallbackTitle: string): ParsedDocument {
  const sections: Section[] = [];
  const stack: { level: number; text: string }[] = [];
  let buffer: string[] = [];
  let fence: string | null = null;
  let title: string | null = null;

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) sections.push({ headings: stack.map((h) => h.text), text });
    buffer = [];
  };

  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fenceMatch) fence = fence === null ? fenceMatch[1]! : fence === fenceMatch[1] ? null : fence;

    const heading = fence === null ? line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/) : null;
    if (!heading) {
      buffer.push(line);
      continue;
    }
    flush();
    const level = heading[1]!.length;
    const text = heading[2]!.trim();
    while (stack.length && stack.at(-1)!.level >= level) stack.pop();
    stack.push({ level, text });
    if (level === 1 && title === null) title = text;
  }
  flush();
  return { title: title ?? fallbackTitle, sections };
}

function parseHtml(html: string, fallbackTitle: string): ParsedDocument {
  const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  turndown.remove(["script", "style", "noscript", "nav", "footer", "iframe", "svg"]);
  const htmlTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  const parsed = parseMarkdown(turndown.turndown(html), htmlTitle || fallbackTitle);
  return htmlTitle ? { ...parsed, title: htmlTitle } : parsed;
}

async function parsePdf(bytes: Uint8Array, fallbackTitle: string): Promise<ParsedDocument> {
  // pdf.js takes ownership of the buffer it is given, so hand it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  const sections = text
    .map((pageText, i) => ({ headings: [], text: pageText.trim(), page: i + 1 }))
    .filter((s) => s.text.length > 0);
  return { title: fallbackTitle, sections };
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function titleFromFilename(filename: string): string {
  const base = path.basename(filename.split(/[?#]/)[0]!);
  const stem = base.replace(/\.[a-z0-9]+$/i, "");
  return stem.replace(/[-_]+/g, " ").trim() || filename;
}
