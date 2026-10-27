/**
 * Retrieval metrics over "rank of the first relevant chunk" per question (1-based,
 * null when nothing relevant came back). Every question has exactly one fact to find,
 * possibly stated in more than one place, so a single rank captures the result.
 */

export const RECALL_CUTOFFS = [1, 3, 5, 10] as const;
/** How many results are retrieved per question; MRR is computed over this depth. */
export const EVAL_DEPTH = 10;

export interface RetrievalScores {
  questions: number;
  /** Share of questions with a relevant chunk in the top k (often called hit rate when there is one fact per question). */
  recall: Record<number, number>;
  /** Mean of 1/rank of the first relevant chunk, 0 when none is retrieved. */
  mrr: number;
}

export function scoreRanks(ranks: (number | null)[], cutoffs: readonly number[] = RECALL_CUTOFFS): RetrievalScores {
  const n = ranks.length;
  const recall: Record<number, number> = {};
  for (const k of cutoffs) recall[k] = n === 0 ? 0 : ranks.filter((r) => r !== null && r <= k).length / n;
  const mrr = n === 0 ? 0 : ranks.reduce<number>((sum, r) => sum + (r === null ? 0 : 1 / r), 0) / n;
  return { questions: n, recall, mrr };
}

/** 1-based rank of the first result for which `relevant` holds, or null. */
export function firstRelevantRank<T>(results: T[], relevant: (item: T) => boolean): number | null {
  const i = results.findIndex(relevant);
  return i === -1 ? null : i + 1;
}
