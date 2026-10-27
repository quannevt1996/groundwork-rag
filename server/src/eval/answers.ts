import type { Answerer } from "../answer/answerer.js";
import type { ResolvedCitation } from "../answer/citations.js";
import { NOT_FOUND_ANSWER } from "../answer/prompt.js";
import type { RetrievedChunk } from "../retrieval/retriever.js";
import { isRelevant, type EvalQuestion } from "./dataset.js";

export type AnswerOutcome = "answered" | "not_found" | "refused" | "empty" | "error";

export interface AnswerCheck {
  id: string;
  outcome: AnswerOutcome;
  answer: string;
  citations: number;
  /** Citations that point into one of the question's gold documents. */
  citationsInGoldDoc: number;
  /** Whether at least one citation points at a chunk containing a gold passage. */
  citesGoldPassage: boolean;
  error?: string;
}

export interface AnswerSummary {
  questions: number;
  answered: number;
  /** Answered questions with at least one citation. */
  cited: number;
  /** Citations into a gold document / all citations. */
  citationPrecision: number;
  /** Questions whose answer cites a chunk that contains a gold passage. */
  citesGoldPassage: number;
}

/**
 * Runs one question through the real answer pipeline and grades the citations
 * mechanically against the gold passages. No LLM judge: this measures whether the
 * answer is grounded in the right place, not whether its prose is good.
 */
export async function checkAnswer(answerer: Answerer, collectionId: string, question: EvalQuestion): Promise<AnswerCheck> {
  let answer = "";
  let retrieved: RetrievedChunk[] = [];
  const citations: ResolvedCitation[] = [];
  const notices: string[] = [];
  let error: string | undefined;

  for await (const event of answerer.answer(collectionId, { message: question.question })) {
    if (event.type === "retrieval") retrieved = event.results;
    else if (event.type === "text") answer += event.delta;
    else if (event.type === "citation") citations.push(event.citation);
    else if (event.type === "notice") notices.push(event.code);
    else if (event.type === "error") error = event.message;
  }

  const byChunk = new Map(retrieved.map((r) => [r.chunkId, r]));
  const goldDocs = new Set(question.relevant.map((p) => p.doc));
  const cited = citations.flatMap((c) => byChunk.get(c.chunkId) ?? []);

  const trimmed = answer.trim();
  const outcome: AnswerOutcome = error
    ? "error"
    : notices.includes("refusal")
      ? "refused"
      : trimmed.startsWith(NOT_FOUND_ANSWER)
        ? "not_found"
        : trimmed
          ? "answered"
          : "empty";

  return {
    id: question.id,
    outcome,
    answer: trimmed,
    citations: citations.length,
    citationsInGoldDoc: cited.filter((chunk) => goldDocs.has(chunk.source)).length,
    citesGoldPassage: cited.some((chunk) => isRelevant(chunk, question)),
    ...(error ? { error } : {}),
  };
}

export function summarizeAnswers(checks: AnswerCheck[]): AnswerSummary {
  const totalCitations = checks.reduce((n, c) => n + c.citations, 0);
  return {
    questions: checks.length,
    answered: checks.filter((c) => c.outcome === "answered").length,
    cited: checks.filter((c) => c.outcome === "answered" && c.citations > 0).length,
    citationPrecision: totalCitations === 0 ? 0 : checks.reduce((n, c) => n + c.citationsInGoldDoc, 0) / totalCitations,
    citesGoldPassage: checks.filter((c) => c.citesGoldPassage).length,
  };
}
