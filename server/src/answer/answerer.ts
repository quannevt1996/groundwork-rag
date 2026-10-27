import type { Config } from "../config.js";
import type { Retriever, RetrievedChunk, SearchMode } from "../retrieval/retriever.js";
import type { Store } from "../store.js";
import { citableBlocks, resolveCitation, type ResolvedCitation } from "./citations.js";
import { describeLlmError, FALLBACK_BETA, type LlmClient } from "./llm.js";
import {
  ANSWER_SYSTEM_PROMPT,
  buildAnswerMessages,
  buildCondenseMessages,
  CONDENSE_SYSTEM_PROMPT,
  NOT_FOUND_ANSWER,
  toSearchResults,
  type HistoryTurn,
} from "./prompt.js";

/** One text block of Claude's answer and the passages it cites. */
export interface AnswerSegment {
  text: string;
  citations: ResolvedCitation[];
}

export type AnswerEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "query"; standalone: string }
  | { type: "retrieval"; results: RetrievedChunk[] }
  | { type: "segment" }
  | { type: "text"; delta: string }
  | { type: "citation"; citation: ResolvedCitation }
  | { type: "notice"; level: "info" | "warning"; code: string; message: string }
  | { type: "done"; messageId: string | null; model?: string; usage?: { inputTokens: number; outputTokens: number } }
  | { type: "error"; message: string };

export class ConversationNotFoundError extends Error {}

export type AnswerConfig = Pick<Config, "ANTHROPIC_MODEL" | "ANTHROPIC_EFFORT" | "RETRIEVAL_TOP_K" | "MIN_VECTOR_SIMILARITY">;

const HISTORY_TURNS = 6;

export class Answerer {
  constructor(
    private readonly store: Store,
    private readonly retriever: Retriever,
    private readonly llm: LlmClient | null,
    private readonly config: AnswerConfig,
  ) {}

  /**
   * Retrieve → (maybe) generate → persist, as a stream of UI events. Retrieval always
   * runs, so the inspector works even when no API key is configured.
   */
  async *answer(
    collectionId: string,
    input: { message: string; conversationId?: string; mode?: SearchMode },
    signal?: AbortSignal,
  ): AsyncGenerator<AnswerEvent> {
    const conversation = input.conversationId
      ? await this.store.getConversation(input.conversationId)
      : await this.store.createConversation(collectionId, input.message.slice(0, 80));
    if (!conversation || conversation.collectionId !== collectionId) throw new ConversationNotFoundError();
    yield { type: "conversation", conversationId: conversation.id };

    const history = recentHistory(await this.store.listMessages(conversation.id));
    await this.store.addMessage({ conversationId: conversation.id, role: "user", content: input.message });

    const query = history.length > 0 && this.llm ? await this.condense(history, input.message) : input.message;
    if (query !== input.message) yield { type: "query", standalone: query };

    const results = await this.retriever.search(collectionId, query, { mode: input.mode, k: this.config.RETRIEVAL_TOP_K });
    yield { type: "retrieval", results };

    if (!this.llm) {
      yield {
        type: "notice",
        level: "warning",
        code: "llm_disabled",
        message:
          "Answer generation is off because ANTHROPIC_API_KEY is not set. Retrieval still ran: " +
          "the passages an answer would be grounded in are listed with their scores.",
      };
      yield { type: "done", messageId: null };
      return;
    }

    if (this.isWeak(results)) {
      const segments: AnswerSegment[] = [{ text: NOT_FOUND_ANSWER, citations: [] }];
      yield { type: "segment" };
      yield { type: "text", delta: NOT_FOUND_ANSWER };
      const messageId = await this.store.addMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: NOT_FOUND_ANSWER,
        segments,
        retrieval: results,
      });
      yield { type: "done", messageId };
      return;
    }

    yield* this.generate(conversation.id, history, input.message, results, signal);
  }

  private async *generate(
    conversationId: string,
    history: HistoryTurn[],
    question: string,
    results: RetrievedChunk[],
    signal?: AbortSignal,
  ): AsyncGenerator<AnswerEvent> {
    const blocks = results.map((r) => citableBlocks(r.content));
    const segments: AnswerSegment[] = [];

    try {
      const stream = this.llm!.stream(
        {
          model: this.config.ANTHROPIC_MODEL,
          max_tokens: 64000,
          thinking: { type: "adaptive" },
          output_config: { effort: this.config.ANTHROPIC_EFFORT },
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          system: ANSWER_SYSTEM_PROMPT,
          messages: buildAnswerMessages(history, question, toSearchResults(results, blocks)),
        },
        signal,
      );

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          if (event.content_block.type === "text") {
            segments.push({ text: "", citations: [] });
            yield { type: "segment" };
          } else if (event.content_block.type === "fallback") {
            const { from, to } = event.content_block;
            yield { type: "notice", level: "info", code: "fallback", message: `${from.model} declined; ${to.model} continued the answer.` };
          }
        } else if (event.type === "content_block_delta") {
          const segment = segments.at(-1);
          if (!segment) continue;
          if (event.delta.type === "text_delta") {
            segment.text += event.delta.text;
            yield { type: "text", delta: event.delta.text };
          } else if (event.delta.type === "citations_delta" && event.delta.citation.type === "search_result_location") {
            const citation = resolveCitation(event.delta.citation, results, blocks);
            if (citation) {
              segment.citations.push(citation);
              yield { type: "citation", citation };
            }
          }
        }
      }

      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") {
        const category = final.stop_details?.category;
        yield {
          type: "notice",
          level: "warning",
          code: "refusal",
          message: `Claude declined to answer${category ? ` (${category})` : ""}.`,
        };
      } else if (final.stop_reason === "max_tokens") {
        yield { type: "notice", level: "warning", code: "truncated", message: "The answer hit the output limit and was cut off." };
      }

      const messageId = await this.store.addMessage({
        conversationId,
        role: "assistant",
        content: segments.map((s) => s.text).join(""),
        segments,
        retrieval: results,
      });
      yield {
        type: "done",
        messageId,
        model: final.model,
        usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens },
      };
    } catch (err) {
      if (signal?.aborted) return;
      yield { type: "error", message: describeLlmError(err) };
    }
  }

  /** Follow-ups like "and how long does that take?" retrieve nothing useful on their own. */
  private async condense(history: HistoryTurn[], message: string): Promise<string> {
    try {
      const response = await this.llm!.create({
        model: this.config.ANTHROPIC_MODEL,
        max_tokens: 4096,
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        system: CONDENSE_SYSTEM_PROMPT,
        messages: buildCondenseMessages(history, message),
      });
      if (response.stop_reason !== "end_turn") return message;
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
      return text || message;
    } catch (err) {
      console.warn(`Query condensation failed, using the raw message: ${describeLlmError(err)}`);
      return message;
    }
  }

  /**
   * Skip the model when retrieval clearly found nothing: no keyword match at all and
   * the best semantic match is below the similarity floor. Cheaper and more honest
   * than asking Claude to answer from irrelevant passages.
   */
  private isWeak(results: RetrievedChunk[]): boolean {
    if (results.length === 0) return true;
    if (results.some((r) => r.keywordRank !== null)) return false;
    const best = Math.max(...results.map((r) => r.vectorScore ?? -1));
    return best < this.config.MIN_VECTOR_SIMILARITY;
  }
}

/** The last few turns, starting on a user turn as the Messages API requires. */
function recentHistory(messages: { role: "user" | "assistant"; content: string }[]): HistoryTurn[] {
  const recent = messages.slice(-HISTORY_TURNS);
  while (recent[0]?.role === "assistant") recent.shift();
  return recent.map(({ role, content }) => ({ role, content }));
}
