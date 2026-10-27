import { inBatches, type Embedder } from "./embedder.js";

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
}

/** Hosted embeddings via Voyage AI's REST API (Anthropic's recommended embeddings provider). */
export class VoyageEmbedder implements Embedder {
  readonly id: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    readonly dim: number,
  ) {
    this.id = `voyage:${model}:${dim}`;
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return inBatches(texts, 64, (batch) => this.embed(batch, "document"));
  }

  async embedQuery(text: string): Promise<number[]> {
    const [v] = await this.embed([text], "query");
    return v!;
  }

  private async embed(input: string[], inputType: "document" | "query"): Promise<number[][]> {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ input, model: this.model, input_type: inputType, output_dimension: this.dim }),
    });
    if (!res.ok) throw new Error(`Voyage embeddings failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as VoyageResponse;
    return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
