/**
 * Retrieval eval. Indexes samples/ into a throwaway in-memory database with the
 * configured embedder, asks every question in eval/questions.json in each retrieval
 * mode, and scores where the first relevant chunk lands. Fully offline once the
 * embedding model is cached; no API key needed.
 *
 *   npm run eval                     # EMBEDDER from the environment (default: local)
 *   EMBEDDER=hash npm run eval       # no model download, deterministic
 *   KEYWORD_MATCH=any npm run eval   # OR-of-terms keyword search instead of all-terms
 *   npm run eval -- --answers        # also grade cited answers; needs ANTHROPIC_API_KEY
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAnthropicClient } from "../answer/llm.js";
import { loadConfig, ROOT_DIR } from "../config.js";
import { openDb } from "../db/client.js";
import { createEmbedder } from "../embeddings/index.js";
import type { SearchMode } from "../retrieval/retriever.js";
import { loadSampleFiles } from "../scripts/samples.js";
import { createServices } from "../services.js";
import { checkAnswer, summarizeAnswers, type AnswerCheck } from "./answers.js";
import { isRelevant, loadDataset, unmatchedQuestions, type JudgedChunk, type QuestionKind } from "./dataset.js";
import { EVAL_DEPTH, firstRelevantRank, RECALL_CUTOFFS, scoreRanks, type RetrievalScores } from "./metrics.js";

const EVAL_DIR = path.join(ROOT_DIR, "eval");
const MODES: SearchMode[] = ["vector", "keyword", "hybrid"];
const KINDS: QuestionKind[] = ["exact", "paraphrase"];

interface QuestionResult {
  id: string;
  kind: QuestionKind;
  mode: SearchMode;
  /** 1-based rank of the first relevant chunk within the top EVAL_DEPTH, or null. */
  rank: number | null;
  ms: number;
  top3: string[];
}

const wantAnswers = process.argv.includes("--answers");
const config = loadConfig();
const questions = await loadDataset(path.join(EVAL_DIR, "questions.json"));

if (config.EMBEDDER === "local") console.error(`Loading ${config.LOCAL_EMBEDDING_MODEL}...`);
const embedder = await createEmbedder(config);
const db = await openDb({});
const llm = wantAnswers && config.llmEnabled ? createAnthropicClient() : null;
const services = await createServices(config, db, embedder, llm);
const { store, ingest, retriever, answerer } = services;

try {
  // 1. Index the corpus through the same ingest path the API uses.
  const collection = await store.createCollection("eval");
  const files = await loadSampleFiles();
  const indexStart = performance.now();
  for (const file of files) await ingest.submit(collection.id, file);
  await ingest.idle();
  const indexMs = performance.now() - indexStart;

  const failed = (await store.listDocuments(collection.id)).filter((d) => d.status !== "ready");
  if (failed.length > 0) throw new Error(`Ingest failed: ${failed.map((d) => `${d.source} (${d.error})`).join(", ")}`);

  // 2. Every gold passage must exist somewhere in the index, or the dataset is wrong.
  const chunks = await db.query<JudgedChunk>(
    "SELECT d.source, c.content FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.collection_id = $1",
    [collection.id],
  );
  const unmatched = unmatchedQuestions(questions, chunks);
  if (unmatched.length > 0) {
    throw new Error(`No indexed chunk contains the gold passage for: ${unmatched.map((q) => q.id).join(", ")}`);
  }

  // 3. Ask every question in every mode.
  const results: QuestionResult[] = [];
  for (const mode of MODES) {
    for (const q of questions) {
      const start = performance.now();
      const hits = await retriever.search(collection.id, q.question, { mode, k: EVAL_DEPTH });
      const ms = performance.now() - start;
      results.push({
        id: q.id,
        kind: q.kind,
        mode,
        rank: firstRelevantRank(hits, (hit) => isRelevant(hit, q)),
        ms,
        top3: hits.slice(0, 3).map((h) => `${h.source} § ${h.section || (h.page ? `p. ${h.page}` : "-")}`),
      });
    }
  }

  const scores = (mode: SearchMode, kind?: QuestionKind): RetrievalScores =>
    scoreRanks(results.filter((r) => r.mode === mode && (!kind || r.kind === kind)).map((r) => r.rank));
  const meanMs = (mode: SearchMode) => {
    const rows = results.filter((r) => r.mode === mode);
    return rows.reduce((sum, r) => sum + r.ms, 0) / rows.length;
  };

  const summary = Object.fromEntries(
    MODES.map((mode) => [
      mode,
      { overall: scores(mode), byKind: Object.fromEntries(KINDS.map((k) => [k, scores(mode, k)])), meanMs: meanMs(mode) },
    ]),
  );

  // 4. Report.
  const count = (kind: QuestionKind) => questions.filter((q) => q.kind === kind).length;
  const f = (x: number) => x.toFixed(2);
  const lines = [
    `Corpus: ${files.length} documents from samples/ (${chunks.length} chunks), indexed in ${(indexMs / 1000).toFixed(1)} s`,
    `Questions: ${questions.length} (${count("exact")} exact-term, ${count("paraphrase")} paraphrased) from eval/questions.json`,
    `Embedder: ${embedder.id} (${embedder.dim}d) · Keyword match: ${config.KEYWORD_MATCH} terms · Database: ${db.kind} · Depth: top ${EVAL_DEPTH}`,
    "",
    `| Mode | ${RECALL_CUTOFFS.map((k) => `Recall@${k}`).join(" | ")} | MRR@${EVAL_DEPTH} | Mean latency |`,
    `| --- | ${RECALL_CUTOFFS.map(() => "---:").join(" | ")} | ---: | ---: |`,
    ...MODES.map((mode) => {
      const s = summary[mode]!.overall;
      return `| ${mode} | ${RECALL_CUTOFFS.map((k) => f(s.recall[k]!)).join(" | ")} | ${f(s.mrr)} | ${summary[mode]!.meanMs.toFixed(1)} ms |`;
    }),
    "",
    `| Mode | Exact: Recall@5 | Exact: MRR | Paraphrased: Recall@5 | Paraphrased: MRR |`,
    `| --- | ---: | ---: | ---: | ---: |`,
    ...MODES.map((mode) => {
      const { exact, paraphrase } = summary[mode]!.byKind as Record<QuestionKind, RetrievalScores>;
      return `| ${mode} | ${f(exact.recall[5]!)} | ${f(exact.mrr)} | ${f(paraphrase.recall[5]!)} | ${f(paraphrase.mrr)} |`;
    }),
  ];

  const misses = results.filter((r) => r.mode === "hybrid" && (r.rank === null || r.rank > 5));
  lines.push("", `Hybrid misses (no relevant chunk in the top 5): ${misses.length === 0 ? "none" : ""}`);
  for (const miss of misses) {
    const q = questions.find((x) => x.id === miss.id)!;
    lines.push(`- ${miss.id} "${q.question}": ${miss.rank ? `first relevant at rank ${miss.rank}` : "not in the top 10"}; top hit ${miss.top3[0] ?? "none"}`);
  }
  const report = lines.join("\n");
  console.log(`\n${report}\n`);

  // 5. Optional: grade cited answers. Costs API calls, so it only runs when asked for.
  let answers: { summary: ReturnType<typeof summarizeAnswers>; checks: AnswerCheck[] } | null = null;
  if (!wantAnswers) {
    console.log("Answer check: skipped (run with --answers and ANTHROPIC_API_KEY set to grade cited answers).");
  } else if (!llm) {
    console.log("Answer check: skipped, ANTHROPIC_API_KEY is not set. Retrieval results above are complete.");
  } else {
    console.log(`Answer check: asking ${config.ANTHROPIC_MODEL} all ${questions.length} questions (hybrid retrieval)...`);
    const checks: AnswerCheck[] = [];
    for (const q of questions) checks.push(await checkAnswer(answerer, collection.id, q));
    const s = summarizeAnswers(checks);
    answers = { summary: s, checks };
    console.log(
      [
        "",
        "| Answered | Answered with citations | Cites a gold passage | Citation precision (gold document) |",
        "| ---: | ---: | ---: | ---: |",
        `| ${s.answered}/${s.questions} | ${s.cited}/${s.questions} | ${s.citesGoldPassage}/${s.questions} | ${f(s.citationPrecision)} |`,
      ].join("\n"),
    );
  }

  // 6. Save everything, keyed by embedder so runs with different models don't overwrite each other.
  const slug =
    embedder.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") +
    (config.KEYWORD_MATCH === "any" ? "-keyword-any" : "");
  const outFile = path.join(EVAL_DIR, "results", `${slug}.json`);
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(
    outFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        embedder: { id: embedder.id, dim: embedder.dim },
        keywordMatch: config.KEYWORD_MATCH,
        database: db.kind,
        corpus: { documents: files.length, chunks: chunks.length, indexMs: Math.round(indexMs) },
        depth: EVAL_DEPTH,
        summary,
        questions: results.map((r) => ({ ...r, ms: Math.round(r.ms * 10) / 10 })),
        answers,
        report,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`\nSaved ${path.relative(ROOT_DIR, outFile)}`);
} finally {
  await db.close();
}
