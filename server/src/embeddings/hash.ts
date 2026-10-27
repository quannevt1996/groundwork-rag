import { l2Normalize, type Embedder } from "./embedder.js";

/**
 * Deterministic feature-hashing embedder (bag of words + bigrams). It carries no
 * semantics beyond lexical overlap, but it is instant and offline, which makes it
 * the right embedder for unit tests and for CI runs that can't download a model.
 */
export class HashEmbedder implements Embedder {
  readonly id: string;

  constructor(readonly dim = 384) {
    this.id = `hash:${dim}`;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embed(t));
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text);
  }

  private embed(text: string): number[] {
    const v = new Array<number>(this.dim).fill(0);
    const words = text.toLowerCase().match(/[a-z0-9]+(?:[-_][a-z0-9]+)*/g) ?? [];
    const features = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
    for (const f of features) {
      const h = fnv1a(f);
      v[h % this.dim]! += h & 0x80000000 ? -1 : 1;
    }
    return l2Normalize(v);
  }
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
