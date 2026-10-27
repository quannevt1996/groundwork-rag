import { afterEach, describe, expect, it } from "vitest";
import { checkAnswer, summarizeAnswers } from "../src/eval/answers.js";
import { isRelevant, unmatchedQuestions, type EvalQuestion } from "../src/eval/dataset.js";
import { firstRelevantRank, scoreRanks } from "../src/eval/metrics.js";
import type { Services } from "../src/services.js";
import { FakeLlm } from "./helpers/fake-llm.js";
import { FIXTURE_DOCS, ingestFiles, makeServices } from "./helpers/services.js";

const question: EvalQuestion = {
  id: "q1",
  kind: "exact",
  question: "What does WL-4291 mean?",
  relevant: [{ doc: "api.md", text: "fail with error   WL-4291" }],
};

describe("eval metrics", () => {
  it("computes recall at each cutoff and MRR from first-relevant ranks", () => {
    const scores = scoreRanks([1, 2, 4, null], [1, 3, 5]);
    expect(scores.questions).toBe(4);
    expect(scores.recall).toEqual({ 1: 0.25, 3: 0.5, 5: 0.75 });
    expect(scores.mrr).toBeCloseTo((1 + 1 / 2 + 1 / 4 + 0) / 4);
  });

  it("handles an empty run", () => {
    expect(scoreRanks([], [1])).toEqual({ questions: 0, recall: { 1: 0 }, mrr: 0 });
  });

  it("finds the 1-based rank of the first relevant item", () => {
    expect(firstRelevantRank(["a", "b", "c"], (x) => x === "b")).toBe(2);
    expect(firstRelevantRank(["a"], () => false)).toBeNull();
  });
});

describe("eval dataset", () => {
  it("judges relevance by document and passage text, ignoring whitespace differences", () => {
    expect(isRelevant({ source: "api.md", content: "Requests fail with error\nWL-4291 and more." }, question)).toBe(true);
    expect(isRelevant({ source: "other.md", content: "fail with error WL-4291" }, question)).toBe(false);
    expect(isRelevant({ source: "api.md", content: "unrelated" }, question)).toBe(false);
  });

  it("reports questions whose gold passage is not in the index", () => {
    const chunks = [{ source: "api.md", content: "Requests fail with error WL-4291." }];
    const typo: EvalQuestion = { ...question, id: "q2", relevant: [{ doc: "api.md", text: "WL-4921" }] };
    expect(unmatchedQuestions([question, typo], chunks).map((q) => q.id)).toEqual(["q2"]);
  });
});

describe("answer check", () => {
  let services: Services | undefined;
  afterEach(() => services?.db.close());

  it("grades an answer by whether its citations land on the gold passage", async () => {
    const llm = new FakeLlm([{ blocks: [{ text: "You were rate limited.", cites: [{ result: 0, start: 0, end: 1 }] }] }]);
    services = await makeServices({ llm, env: { MIN_VECTOR_SIMILARITY: "-1" } });
    const collectionId = (await services.store.createCollection("docs")).id;
    await ingestFiles(services, collectionId, FIXTURE_DOCS);

    const check = await checkAnswer(services.answerer, collectionId, { ...question, question: "WL-4291" });
    expect(check).toEqual({
      id: "q1",
      outcome: "answered",
      answer: "You were rate limited.",
      citations: 1,
      citationsInGoldDoc: 1,
      citesGoldPassage: true,
    });
    const notFound = { ...check, id: "q2", outcome: "not_found" as const, citations: 0, citationsInGoldDoc: 0, citesGoldPassage: false };
    expect(summarizeAnswers([check, notFound])).toEqual({
      questions: 2,
      answered: 1,
      cited: 1,
      citationPrecision: 1,
      citesGoldPassage: 1,
    });
  });
});
