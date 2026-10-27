export interface Embedder {
  /** Stable identifier persisted with the index, e.g. "local:Xenova/bge-small-en-v1.5". */
  readonly id: string;
  readonly dim: number;
  /** Passages are embedded once at ingest time. */
  embedDocuments(texts: string[]): Promise<number[][]>;
  /** Queries can be embedded differently (asymmetric models use an instruction prefix). */
  embedQuery(text: string): Promise<number[]>;
}

export function l2Normalize(v: number[]): number[] {
  const norm = Math.hypot(...v);
  return norm === 0 ? v : v.map((x) => x / norm);
}

export async function inBatches<T, R>(items: T[], size: number, fn: (batch: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await fn(items.slice(i, i + size))));
  return out;
}
