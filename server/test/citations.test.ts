import { describe, expect, it } from "vitest";
import { citableBlocks, resolveCitation } from "../src/answer/citations.js";
import { toSearchResults } from "../src/answer/prompt.js";
import type { RetrievedChunk } from "../src/retrieval/retriever.js";

function chunk(id: string, content: string, extra: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId: id,
    documentId: `doc_${id}`,
    documentTitle: `Title ${id}`,
    source: `${id}.md`,
    section: "Guide > Setup",
    page: null,
    content,
    rank: 1,
    fusedScore: 0.03,
    vectorRank: 1,
    vectorScore: 0.8,
    keywordRank: null,
    keywordScore: null,
    ...extra,
  };
}

describe("citableBlocks", () => {
  const content = "Snapshots run every 6 hours. They are kept for 35 days.\n\n  Logs are kept for 90 days.\n- Billing: 7 years.";

  it("splits a chunk into sentence blocks whose offsets point back into the chunk", () => {
    const blocks = citableBlocks(content);
    expect(blocks.map((b) => b.text)).toEqual([
      "Snapshots run every 6 hours.",
      "They are kept for 35 days.",
      "Logs are kept for 90 days.",
      "- Billing: 7 years.",
    ]);
    for (const block of blocks) expect(content.slice(block.start, block.end)).toBe(block.text);
  });

  it("keeps a heading or list number with the text it numbers", () => {
    const numbered = "1. Purpose and scope. We keep data. 2) Next item here.";
    expect(citableBlocks(numbered).map((b) => b.text)).toEqual(["1. Purpose and scope.", "We keep data.", "2) Next item here."]);
  });

  it("returns nothing for blank content", () => {
    expect(citableBlocks("  \n\n ")).toEqual([]);
  });
});

describe("resolveCitation", () => {
  const sources = [chunk("a", "Alpha one. Alpha two. Alpha three."), chunk("b", "Beta one.", { page: 4, section: "" })];
  const blocks = sources.map((s) => citableBlocks(s.content));

  const citation = (index: number, start: number, end: number) => ({
    type: "search_result_location" as const,
    search_result_index: index,
    start_block_index: start,
    end_block_index: end,
    cited_text: "",
    source: "",
    title: null,
  });

  it("maps a block range to the chunk and the character span of the cited sentences", () => {
    const resolved = resolveCitation(citation(0, 1, 3), sources, blocks)!;
    expect(resolved).toMatchObject({ sourceIndex: 0, chunkId: "a", documentId: "doc_a", documentTitle: "Title a" });
    expect(sources[0]!.content.slice(resolved.start, resolved.end)).toBe("Alpha two. Alpha three.");
  });

  it("carries the page and section of the cited chunk", () => {
    expect(resolveCitation(citation(1, 0, 1), sources, blocks)).toMatchObject({ chunkId: "b", page: 4, section: "" });
  });

  it("returns null for indexes outside this turn's results", () => {
    expect(resolveCitation(citation(2, 0, 1), sources, blocks)).toBeNull();
    expect(resolveCitation(citation(0, 0, 9), sources, blocks)).toBeNull();
  });
});

describe("toSearchResults", () => {
  it("sends each chunk as a citable search_result made of its sentence blocks", () => {
    const sources = [chunk("a", "One. Two."), chunk("b", "Three.", { section: "", page: 2 })];
    const results = toSearchResults(
      sources,
      sources.map((s) => citableBlocks(s.content)),
    );
    expect(results[0]).toEqual({
      type: "search_result",
      source: "a.md#a",
      title: "Title a — Guide > Setup",
      content: [
        { type: "text", text: "One." },
        { type: "text", text: "Two." },
      ],
      citations: { enabled: true },
    });
    expect(results[1]!.title).toBe("Title b — p. 2");
  });
});
