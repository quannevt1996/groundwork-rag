import { describe, expect, it } from "vitest";
import { reciprocalRankFusion, RRF_K } from "../src/retrieval/rrf.js";

describe("reciprocalRankFusion", () => {
  it("scores each item as the sum of 1 / (k + rank) over the lists it appears in", () => {
    const fused = reciprocalRankFusion([
      ["a", "b"],
      ["b", "c"],
    ]);
    const score = Object.fromEntries(fused.map((f) => [f.id, f.score]));
    expect(RRF_K).toBe(60);
    expect(score.a).toBeCloseTo(1 / 61);
    expect(score.b).toBeCloseTo(1 / 62 + 1 / 61);
    expect(score.c).toBeCloseTo(1 / 62);
    expect(fused.map((f) => f.id)).toEqual(["b", "a", "c"]);
  });

  it("ranks an item that both retrievers found above one only a single retriever ranked first", () => {
    const fused = reciprocalRankFusion([
      ["only-vector", "shared"],
      ["only-keyword", "x", "shared"],
    ]);
    expect(fused[0]!.id).toBe("shared");
  });

  it("preserves the order of a single list", () => {
    expect(reciprocalRankFusion([["c", "a", "b"]]).map((f) => f.id)).toEqual(["c", "a", "b"]);
  });

  it("ignores empty lists, so one retriever finding nothing degrades to the other", () => {
    expect(reciprocalRankFusion([["a", "b"], []]).map((f) => f.id)).toEqual(["a", "b"]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });

  it("lets a smaller k reward top ranks more strongly", () => {
    // "c" is found by both lists, but low down; "a" is first in one list only.
    const lists = [["a", "x1", "x2", "x3", "x4", "x5", "c"], ["y", "c"]];
    expect(reciprocalRankFusion(lists, 60)[0]!.id).toBe("c");
    expect(reciprocalRankFusion(lists, 1)[0]!.id).toBe("a");
  });
});
