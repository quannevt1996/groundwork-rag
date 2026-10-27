import { describe, expect, it } from "vitest";
import { detectKind, parseDocument, parseMarkdown, pdfPageText } from "../src/ingest/parse.js";
import { makePdf } from "./helpers/pdf.js";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("detectKind", () => {
  it("prefers the MIME type, then the extension", () => {
    expect(detectKind("notes.txt", "application/pdf")).toBe("pdf");
    expect(detectKind("page", "text/html; charset=utf-8")).toBe("html");
    expect(detectKind("guide.md", "")).toBe("markdown");
    expect(detectKind("guide.MARKDOWN", "application/octet-stream")).toBe("markdown");
    expect(detectKind("https://example.com/docs/page.html?x=1#top", "")).toBe("html");
    expect(detectKind("readme", "text/plain")).toBe("text");
  });

  it("rejects types it cannot parse", () => {
    expect(detectKind("photo.png", "image/png")).toBeNull();
    expect(detectKind("archive.zip", "")).toBeNull();
  });
});

describe("parseMarkdown", () => {
  it("splits at headings and records the heading path", () => {
    const doc = parseMarkdown("# Guide\n\nIntro.\n\n## Setup\n\nInstall it.\n\n### Linux\n\nUse apt.\n\n## Usage\n\nRun it.", "fallback");
    expect(doc.title).toBe("Guide");
    expect(doc.sections).toEqual([
      { headings: ["Guide"], text: "Intro." },
      { headings: ["Guide", "Setup"], text: "Install it." },
      { headings: ["Guide", "Setup", "Linux"], text: "Use apt." },
      { headings: ["Guide", "Usage"], text: "Run it." },
    ]);
  });

  it("ignores # lines inside fenced code blocks", () => {
    const doc = parseMarkdown("# Script\n\n```bash\n# not a heading\necho hi\n```\n\nAfter.", "fallback");
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]!.text).toContain("# not a heading");
    expect(doc.sections[0]!.text).toContain("After.");
  });

  it("keeps text before the first heading and falls back to the given title", () => {
    const doc = parseMarkdown("Preamble.\n\n## Part\n\nBody.", "My notes");
    expect(doc.title).toBe("My notes");
    expect(doc.sections[0]).toEqual({ headings: [], text: "Preamble." });
  });
});

describe("parseDocument", () => {
  it("converts HTML to sections and drops page chrome", async () => {
    const html = `<!doctype html><html><head><title>Help Center</title><style>p{}</style>
      <script>track()</script></head><body><nav>Home · Docs</nav>
      <h1>FAQ</h1><h2>Limits</h2><p>Set max_batch_rows to 500.</p>
      <footer>Copyright</footer></body></html>`;
    const doc = await parseDocument(bytes(html), "html", "faq.html");
    expect(doc.title).toBe("Help Center");
    expect(doc.sections).toEqual([{ headings: ["FAQ", "Limits"], text: "Set max_batch_rows to 500." }]);
    const all = JSON.stringify(doc.sections);
    for (const noise of ["track()", "Home", "Copyright", "Help Center"]) expect(all).not.toContain(noise);
  });

  it("reads plain text as one untitled section", async () => {
    const doc = await parseDocument(bytes("  Line one.\n\nLine two.  "), "text", "/tmp/release_notes-v2.txt");
    expect(doc.title).toBe("release notes v2");
    expect(doc.sections).toEqual([{ headings: [], text: "Line one.\n\nLine two." }]);
  });

  it("reads PDFs page by page, rejoining wrapped lines into paragraphs", async () => {
    const longSentence =
      "The retry scheduler opened one transaction per delivery and kept it open while computing the backoff delay.";
    const pdf = makePdf([`Summary\n\n${longSentence}`, "Action items\n\nACT-112: Lower the timeout."], {
      title: "Postmortem 14",
      wrapAt: 40,
    });
    const doc = await parseDocument(pdf, "pdf", "pm.pdf");
    expect(doc.title).toBe("Postmortem 14");
    expect(doc.sections.map((s) => s.page)).toEqual([1, 2]);
    expect(doc.sections[0]!.text).toBe(`Summary\n\n${longSentence}`);
    expect(doc.sections[1]!.text).toBe("Action items\n\nACT-112: Lower the timeout.");
  });

  it("falls back to the filename when a PDF has no title metadata", async () => {
    const doc = await parseDocument(makePdf(["Hello."]), "pdf", "quarterly-report.pdf");
    expect(doc.title).toBe("quarterly report");
  });
});

describe("pdfPageText", () => {
  const line = (str: string, y: number) => ({ str, y, fontSize: 10, hasEOL: true });

  it("joins lines at normal spacing and breaks paragraphs at larger gaps", () => {
    const text = pdfPageText([
      line("First paragraph wraps", 700),
      line("onto a second line.", 686),
      line("Second paragraph.", 658),
    ]);
    expect(text).toBe("First paragraph wraps onto a second line.\n\nSecond paragraph.");
  });

  it("joins a line ending in a hyphen without a space", () => {
    expect(pdfPageText([line("Deployed to prod-", 700), line("us2 today.", 686)])).toBe("Deployed to prod-us2 today.");
  });

  it("splits a page with no wrapped lines at all, using the font size as the line-height cap", () => {
    expect(pdfPageText([line("Heading", 700), line("One short paragraph.", 672)])).toBe("Heading\n\nOne short paragraph.");
  });

  it("still joins double-spaced lines", () => {
    expect(pdfPageText([line("A double-spaced", 700), line("sentence.", 680)])).toBe("A double-spaced sentence.");
  });

  it("starts a new paragraph when text jumps back up the page (a new column)", () => {
    const text = pdfPageText([line("Left column.", 700), line("More left.", 686), line("Right column.", 700)]);
    expect(text).toBe("Left column. More left.\n\nRight column.");
  });

  it("merges items that share a line and skips empty ones", () => {
    const text = pdfPageText([
      { str: "Hello ", y: 700, fontSize: 10, hasEOL: false },
      { str: "world.", y: 700, fontSize: 10, hasEOL: true },
      { str: "", y: 690, fontSize: 10, hasEOL: true },
    ]);
    expect(text).toBe("Hello world.");
  });
});
