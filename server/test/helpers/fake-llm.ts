import type {
  BetaMessage,
  BetaSearchResultBlockParam,
  BetaStreamEvent,
  CreateParams,
  LlmClient,
  ModelStream,
  StreamParams,
} from "../../src/answer/llm.js";

export interface ScriptedBlock {
  text: string;
  /** Citations as (search result index, first block, end block exclusive), like the API's search_result_location. */
  cites?: { result: number; start: number; end: number }[];
}

export interface ScriptedTurn {
  blocks?: ScriptedBlock[];
  stopReason?: BetaMessage["stop_reason"];
  refusalCategory?: string;
  /** Thrown after the first block has streamed, to simulate a dropped connection or API error. */
  error?: Error;
}

/**
 * Stands in for the Anthropic client. Each `stream` call replays the next scripted
 * turn as SDK-shaped events (content_block_start, citations_delta, text_delta), so
 * the answerer's real event handling and citation resolution run unchanged.
 */
export class FakeLlm implements LlmClient {
  readonly streamCalls: StreamParams[] = [];
  readonly createCalls: CreateParams[] = [];

  constructor(
    private readonly turns: ScriptedTurn[] = [],
    /** What `create` (query condensation) returns. */
    private readonly condensedQuery = "standalone query",
  ) {}

  stream(params: StreamParams): ModelStream {
    this.streamCalls.push(params);
    const turn = this.turns.shift() ?? { blocks: [{ text: "OK." }] };
    const sources = lastUserSearchResults(params);
    const events = scriptEvents(turn, sources);
    const final = finalMessage(params.model, turn);
    return {
      async *[Symbol.asyncIterator]() {
        for (const [i, event] of events.entries()) {
          if (turn.error && i > 0 && event.type === "content_block_start") throw turn.error;
          yield event;
        }
        if (turn.error) throw turn.error;
      },
      finalMessage: async () => final,
    };
  }

  async create(params: CreateParams): Promise<BetaMessage> {
    this.createCalls.push(params);
    return finalMessage(params.model, { blocks: [{ text: this.condensedQuery }], stopReason: "end_turn" });
  }
}

function lastUserSearchResults(params: StreamParams): BetaSearchResultBlockParam[] {
  const content = params.messages.at(-1)?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((b) => (b.type === "search_result" ? [b] : []));
}

function scriptEvents(turn: ScriptedTurn, sources: BetaSearchResultBlockParam[]): BetaStreamEvent[] {
  const events: unknown[] = [];
  (turn.blocks ?? []).forEach((block, index) => {
    events.push({ type: "content_block_start", index, content_block: { type: "text", text: "", citations: [] } });
    for (const cite of block.cites ?? []) {
      const source = sources[cite.result];
      const citedText = (source?.content ?? [])
        .slice(cite.start, cite.end)
        .map((b) => b.text)
        .join(" ");
      events.push({
        type: "content_block_delta",
        index,
        delta: {
          type: "citations_delta",
          citation: {
            type: "search_result_location",
            search_result_index: cite.result,
            start_block_index: cite.start,
            end_block_index: cite.end,
            cited_text: citedText,
            source: source?.source ?? "",
            title: source?.title ?? null,
          },
        },
      });
    }
    events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
    events.push({ type: "content_block_stop", index });
  });
  return events as BetaStreamEvent[];
}

function finalMessage(model: string, turn: ScriptedTurn): BetaMessage {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model,
    content: (turn.blocks ?? []).map((b) => ({ type: "text", text: b.text, citations: null })),
    stop_reason: turn.stopReason ?? "end_turn",
    stop_details: turn.stopReason === "refusal" ? { type: "refusal", category: turn.refusalCategory ?? null, explanation: null } : null,
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 30 },
  } as unknown as BetaMessage;
}
