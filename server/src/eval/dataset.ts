import { readFile } from "node:fs/promises";
import { z } from "zod";

const Passage = z.object({
  /** Source filename of the document, as ingested from samples/. */
  doc: z.string().min(1),
  /** Text the relevant chunk must contain. */
  text: z.string().min(1),
});

const Question = z.object({
  id: z.string().min(1),
  kind: z.enum(["exact", "paraphrase"]),
  question: z.string().min(1),
  /** Any one of these passages answers the question. */
  relevant: z.array(Passage).min(1),
});

const Dataset = z.object({
  description: z.string().optional(),
  questions: z.array(Question).min(1),
});

export type EvalQuestion = z.infer<typeof Question>;
export type QuestionKind = EvalQuestion["kind"];

/** The two chunk fields relevance is judged on. */
export interface JudgedChunk {
  source: string;
  content: string;
}

export async function loadDataset(file: string): Promise<EvalQuestion[]> {
  const { questions } = Dataset.parse(JSON.parse(await readFile(file, "utf8")));
  const ids = new Set<string>();
  for (const q of questions) {
    if (ids.has(q.id)) throw new Error(`Duplicate question id ${q.id} in ${file}`);
    ids.add(q.id);
  }
  return questions;
}

/**
 * Gold labels point at passages, not chunk ids: chunk ids are random per ingest and
 * chunk boundaries move whenever chunking changes, but "this document, containing
 * this sentence" survives both.
 */
export function isRelevant(chunk: JudgedChunk, question: EvalQuestion): boolean {
  const content = normalize(chunk.content);
  return question.relevant.some((p) => p.doc === chunk.source && content.includes(normalize(p.text)));
}

/** Questions none of whose passages appear in any indexed chunk. These are dataset bugs, not misses. */
export function unmatchedQuestions(questions: EvalQuestion[], chunks: JudgedChunk[]): EvalQuestion[] {
  return questions.filter((q) => !chunks.some((c) => isRelevant(c, q)));
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
