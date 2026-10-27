/** The constant from Cormack et al. (2009); it damps the advantage of rank 1 over rank 2. */
export const RRF_K = 60;

export interface Fused {
  id: string;
  score: number;
}

/**
 * Reciprocal Rank Fusion: score(d) = Σ 1 / (k + rank_i(d)) over every ranked list
 * that contains d (ranks are 1-based). It needs only ranks, never raw scores, which
 * is why it can merge cosine similarities and ts_rank values that live on unrelated scales.
 */
export function reciprocalRankFusion(lists: string[][], k = RRF_K): Fused[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  }
  return [...scores].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}
