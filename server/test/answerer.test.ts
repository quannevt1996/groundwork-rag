import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationNotFoundError, type AnswerEvent } from "../src/answer/answerer.js";
import { ANSWER_SYSTEM_PROMPT, NOT_FOUND_ANSWER } from "../src/answer/prompt.js";
import type { Services } from "../src/services.js";
import { FakeLlm, type ScriptedTurn } from "./helpers/fake-llm.js";
import { FIXTURE_DOCS, ingestFiles, makeServices } from "./helpers/services.js";

let services: Services | undefined;
afterEach(() => services?.db.close());

/**
 * Hash-embedder similarities sit far below the default "not found" floor, so tests that
 * need the model to run turn the floor off; the weak-retrieval test keeps the default.
 */
const NO_FLOOR = { MIN_VECTOR_SIMILARITY: "-1" };

/** Services with the fixture docs ingested and a scripted model. */
async function setup(turns: ScriptedTurn[] | null, env: Record<string, string> = {}) {
  const llm = turns ? new FakeLlm(turns) : null;
  services = await makeServices({ llm, env });
  const collectionId = (await services.store.createCollection("docs")).id;
  await ingestFiles(services, collectionId, FIXTURE_DOCS);
  return { services, llm, collectionId };
}

async function collect(events: AsyncIterable<AnswerEvent>): Promise<AnswerEvent[]> {
  const out: AnswerEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const ofType = <T extends AnswerEvent["type"]>(events: AnswerEvent[], type: T) =>
  events.filter((e): e is Extract<AnswerEvent, { type: T }> => e.type === type);

describe("Answerer", () => {
  it("without an API key, still retrieves and explains why there is no answer", async () => {
    const { services, collectionId } = await setup(null);
    const events = await collect(services.answerer.answer(collectionId, { message: "What does WL-4291 mean?" }));

    expect(events.map((e) => e.type)).toEqual(["conversation", "retrieval", "notice", "done"]);
    expect(ofType(events, "retrieval")[0]!.results[0]!.content).toContain("WL-4291");
    expect(ofType(events, "notice")[0]).toMatchObject({ level: "warning", code: "llm_disabled" });
    expect(ofType(events, "done")[0]!.messageId).toBeNull();

    const conversationId = ofType(events, "conversation")[0]!.conversationId;
    const messages = await services.store.listMessages(conversationId);
    expect(messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("streams text and resolves citations to the retrieved chunks, then persists the answer", async () => {
    const { services, llm, collectionId } = await setup([
      {
        blocks: [
          { text: "It means you hit the rate limit", cites: [{ result: 0, start: 0, end: 1 }] },
          { text: " of 600 requests per minute." },
        ],
      },
    ], NO_FLOOR);
    const events = await collect(
      services.answerer.answer(collectionId, { message: "What does WL-4291 mean?", mode: "vector" }),
    );

    expect(events.map((e) => e.type)).toEqual([
      "conversation",
      "retrieval",
      "segment",
      "citation",
      "text",
      "segment",
      "text",
      "done",
    ]);
    const [retrieval] = ofType(events, "retrieval");
    const [citation] = ofType(events, "citation");
    const top = retrieval!.results[0]!;
    expect(citation!.citation).toMatchObject({ sourceIndex: 0, chunkId: top.chunkId, documentTitle: "API reference" });
    expect(top.content.slice(citation!.citation.start, citation!.citation.end)).toBe(citation!.citation.citedText);

    // The request: configured model, adaptive thinking, the system prompt, and the chunks as citable search results.
    const params = llm!.streamCalls[0]!;
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.system).toBe(ANSWER_SYSTEM_PROMPT);
    const content = params.messages.at(-1)!.content as { type: string; citations?: unknown; source?: string }[];
    expect(content.at(-1)).toEqual({ type: "text", text: "What does WL-4291 mean?" });
    expect(content.slice(0, -1).every((b) => b.type === "search_result")).toBe(true);
    expect(content[0]!.source).toBe(`api.md#${top.chunkId}`);

    const [done] = ofType(events, "done");
    expect(done).toMatchObject({ model: "claude-opus-5-5", usage: { inputTokens: 120, outputTokens: 30 } });
    const messages = await services.store.listMessages(ofType(events, "conversation")[0]!.conversationId);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[1]!.content).toBe("It means you hit the rate limit of 600 requests per minute.");
    expect(messages[1]!.segments).toEqual([
      { text: "It means you hit the rate limit", citations: [citation!.citation] },
      { text: " of 600 requests per minute.", citations: [] },
    ]);
  });

  it("answers 'not found' without calling the model when retrieval is clearly weak", async () => {
    // With the hash embedder, unrelated text has near-zero similarity, so the default floor applies.
    const { services, llm, collectionId } = await setup([]);
    const events = await collect(services.answerer.answer(collectionId, { message: "favourite pizza topping" }));
    expect(ofType(events, "text").map((e) => e.delta).join("")).toBe(NOT_FOUND_ANSWER);
    expect(llm!.streamCalls).toHaveLength(0);
  });

  it("reports a refusal as a notice", async () => {
    const { services, collectionId } = await setup([{ blocks: [], stopReason: "refusal", refusalCategory: "cyber" }]);
    const events = await collect(services.answerer.answer(collectionId, { message: "WL-4291" }));
    expect(ofType(events, "notice")[0]).toMatchObject({ code: "refusal", message: "Claude declined to answer (cyber)." });
  });

  it("reports a truncated answer", async () => {
    const { services, collectionId } = await setup([{ blocks: [{ text: "Partial" }], stopReason: "max_tokens" }]);
    const events = await collect(services.answerer.answer(collectionId, { message: "WL-4291" }));
    expect(ofType(events, "notice")[0]).toMatchObject({ code: "truncated" });
  });

  it("turns an API failure mid-stream into an error event with a safe message", async () => {
    const error = new Anthropic.APIConnectionError({ message: "socket hang up" });
    const { services, collectionId } = await setup([{ blocks: [{ text: "Starting" }, { text: "never sent" }], error }]);
    const events = await collect(services.answerer.answer(collectionId, { message: "WL-4291" }));
    expect(events.at(-1)).toEqual({ type: "error", message: "Couldn't reach the Anthropic API." });
    expect(ofType(events, "done")).toHaveLength(0);
  });

  it("rewrites follow-up questions into a standalone query before retrieving", async () => {
    const { services, llm, collectionId } = await setup(
      [{ blocks: [{ text: "First." }] }, { blocks: [{ text: "Second." }] }],
      NO_FLOOR,
    );
    const first = await collect(services.answerer.answer(collectionId, { message: "What does WL-4291 mean?" }));
    const conversationId = ofType(first, "conversation")[0]!.conversationId;

    const second = await collect(services.answerer.answer(collectionId, { message: "and how do I avoid it?", conversationId }));
    expect(ofType(second, "query")[0]).toEqual({ type: "query", standalone: "standalone query" });
    expect(llm!.createCalls).toHaveLength(1);
    // History is replayed as plain text before the new question.
    expect(llm!.streamCalls[1]!.messages.slice(0, 2)).toEqual([
      { role: "user", content: "What does WL-4291 mean?" },
      { role: "assistant", content: "First." },
    ]);
  });

  it("rejects a conversation that belongs to another collection", async () => {
    const { services, collectionId } = await setup(null);
    const other = await services.store.createCollection("other");
    const conversation = await services.store.createConversation(other.id, "elsewhere");
    await expect(
      collect(services.answerer.answer(collectionId, { message: "hi", conversationId: conversation.id })),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);
  });
});
