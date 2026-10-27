import { describe, expect, it } from "vitest";
import { chunkSections, splitSentences } from "../src/ingest/chunker.js";
import type { Section } from "../src/ingest/parse.js";

const sentence = (i: number) => `Sentence number ${i} explains one small fact about the system.`;
const paragraph = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => sentence(from + i)).join(" ");

describe("chunkSections", () => {
  it("keeps a short section as one chunk with its heading path and page", () => {
    const chunks = chunkSections([{ headings: ["Guide", "Setup"], text: "Install it.", page: 3 }]);
    expect(chunks).toEqual([{ headings: ["Guide", "Setup"], page: 3, content: "Install it.", tokenEstimate: 3 }]);
  });

  it("never merges two sections, even when both are tiny", () => {
    const sections: Section[] = [
      { headings: ["A"], text: "Alpha." },
      { headings: ["B"], text: "Beta." },
    ];
    expect(chunkSections(sections).map((c) => c.headings)).toEqual([["A"], ["B"]]);
  });

  it("packs paragraphs up to maxChars and repeats whole trailing sentences as overlap", () => {
    const text = [paragraph(1, 3), paragraph(4, 3), paragraph(7, 3), paragraph(10, 3)].join("\n\n");
    const chunks = chunkSections([{ headings: ["Long"], text }], { maxChars: 450, overlapChars: 120 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(450);
    for (let i = 1; i < chunks.length; i++) {
      const previousSentences = splitSentences(chunks[i - 1]!.content);
      const firstSentence = splitSentences(chunks[i]!.content)[0]!;
      // The overlap is a whole sentence taken from the end of the previous chunk, never a fragment.
      expect(previousSentences).toContain(firstSentence);
    }
    // Every sentence of the source survives somewhere.
    for (let i = 1; i <= 12; i++) expect(chunks.some((c) => c.content.includes(sentence(i)))).toBe(true);
  });

  it("splits an oversize paragraph by sentences, and an oversize sentence by words", () => {
    const longWordy = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkSections([{ headings: [], text: `${paragraph(1, 6)} ${longWordy}` }], {
      maxChars: 200,
      overlapChars: 0,
    });
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(200);
    expect(chunks.map((c) => c.content).join(" ")).toContain("word79");
  });

  it("keeps a fenced code block whole even when it contains blank lines", () => {
    const code = "```js\nconst a = 1;\n\nconst b = 2;\n```";
    const chunks = chunkSections([{ headings: ["Code"], text: `Intro.\n\n${code}\n\nOutro.` }], {
      maxChars: 60,
      overlapChars: 0,
    });
    expect(chunks.some((c) => c.content.includes(code))).toBe(true);
  });
});

describe("splitSentences", () => {
  it("splits on sentence punctuation followed by a capital, digit or quote, and on newlines", () => {
    expect(splitSentences('Ready. Set? Go! 3 more. "Quoted" end.\nNext line')).toEqual([
      "Ready.",
      "Set?",
      "Go!",
      "3 more.",
      '"Quoted" end.',
      "Next line",
    ]);
  });

  it("does not split inside identifiers or decimals", () => {
    expect(splitSentences("Set db.pool.max_connections to 2.5 times the default. Done.")).toEqual([
      "Set db.pool.max_connections to 2.5 times the default.",
      "Done.",
    ]);
  });
});
