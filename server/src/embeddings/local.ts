import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { inBatches, type Embedder } from "./embedder.js";

interface ModelProfile {
  pooling: "mean" | "cls";
  /** Instruction prepended to queries only (asymmetric retrieval models). */
  queryPrefix: string;
}

const PROFILES: Record<string, ModelProfile> = {
  "Xenova/bge-small-en-v1.5": {
    pooling: "cls",
    queryPrefix: "Represent this sentence for searching relevant passages: ",
  },
  "Xenova/all-MiniLM-L6-v2": { pooling: "mean", queryPrefix: "" },
};

/**
 * Runs a sentence-embedding model in-process via ONNX Runtime. No API key, no
 * network after the first download — documents never leave the machine.
 */
export class LocalEmbedder implements Embedder {
  readonly id: string;

  private constructor(
    private readonly extractor: FeatureExtractionPipeline,
    private readonly profile: ModelProfile,
    model: string,
    readonly dim: number,
  ) {
    this.id = `local:${model}`;
  }

  static async load(model: string, cacheDir: string): Promise<LocalEmbedder> {
    env.cacheDir = cacheDir;
    const profile = PROFILES[model] ?? { pooling: "mean", queryPrefix: "" };
    const extractor = await pipeline("feature-extraction", model, { dtype: "fp32" });
    const probe = await extractor("dimension probe", { pooling: profile.pooling, normalize: true });
    const dim = probe.dims.at(-1);
    if (!dim) throw new Error(`Could not determine embedding size for ${model}`);
    return new LocalEmbedder(extractor, profile, model, dim);
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return inBatches(texts, 16, (batch) => this.run(batch));
  }

  async embedQuery(text: string): Promise<number[]> {
    const [v] = await this.run([this.profile.queryPrefix + text]);
    return v!;
  }

  private async run(texts: string[]): Promise<number[][]> {
    const output = await this.extractor(texts, { pooling: this.profile.pooling, normalize: true });
    return output.tolist() as number[][];
  }
}
