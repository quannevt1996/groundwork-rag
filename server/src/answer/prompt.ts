import type { RetrievedChunk } from "../retrieval/retriever.js";
import type { CitableBlock } from "./citations.js";
import type { BetaMessageParam, BetaSearchResultBlockParam } from "./llm.js";

export const NOT_FOUND_ANSWER = "I couldn't find this in your documents.";

export const ANSWER_SYSTEM_PROMPT = `You answer questions using only the user's own documents. Each question arrives with passages retrieved from their document collection.

- Base every statement on those passages. Do not fill gaps with outside knowledge, even when you are confident.
- If the passages don't contain the answer, reply "${NOT_FOUND_ANSWER}" and, at most, one sentence naming the closest related topic they do cover.
- If the passages answer only part of the question, answer that part and say plainly what is missing.
- Be direct and concise. Write plain prose or short "-" bullet lists; no headings or tables.
- Refer to the material as "your documents", not as search results.`;

export const CONDENSE_SYSTEM_PROMPT = `Rewrite the user's final message as a standalone search query for their document collection, resolving pronouns and references from the conversation. Keep exact identifiers (error codes, config keys, names) verbatim. Output only the query.`;

export function toSearchResults(chunks: RetrievedChunk[], blocks: CitableBlock[][]): BetaSearchResultBlockParam[] {
  return chunks.map((chunk, i) => ({
    type: "search_result",
    source: `${chunk.source}#${chunk.chunkId}`,
    title: [chunk.documentTitle, chunk.section, chunk.page ? `p. ${chunk.page}` : ""].filter(Boolean).join(" — "),
    content: blocks[i]!.map((b) => ({ type: "text", text: b.text })),
    citations: { enabled: true },
  }));
}

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Earlier turns are replayed as plain text. Their citations are dropped on purpose:
 * only the current turn's passages are attached, so `search_result_index` in the
 * response always indexes this turn's retrieval results.
 */
export function buildAnswerMessages(history: HistoryTurn[], question: string, sources: BetaSearchResultBlockParam[]): BetaMessageParam[] {
  return [
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: [...sources, { type: "text", text: question }] },
  ];
}

export function buildCondenseMessages(history: HistoryTurn[], message: string): BetaMessageParam[] {
  const transcript = history.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`).join("\n\n");
  return [
    {
      role: "user",
      content: `<conversation>\n${transcript}\n</conversation>\n\n<final_message>\n${message}\n</final_message>`,
    },
  ];
}
