import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";

export type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
export type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
export type BetaStreamEvent = Anthropic.Beta.Messages.BetaRawMessageStreamEvent;
export type BetaSearchResultBlockParam = Anthropic.Beta.Messages.BetaSearchResultBlockParam;
export type BetaCitationSearchResultLocation = Anthropic.Beta.Messages.BetaCitationSearchResultLocation;
export type StreamParams = BetaMessageStreamParams;
export type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** `fallbacks: "default"` lets the API re-run a policy-declined request on Anthropic's recommended fallback model. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export interface ModelStream extends AsyncIterable<BetaStreamEvent> {
  finalMessage(): Promise<BetaMessage>;
}

/**
 * The slice of the Anthropic SDK the app uses. Production passes the real client;
 * tests pass a scripted stub that replays SDK-shaped stream events, so the citation
 * and persistence code under test is the same code that runs against the API.
 */
export interface LlmClient {
  stream(params: StreamParams, signal?: AbortSignal): ModelStream;
  create(params: CreateParams): Promise<BetaMessage>;
}

export function createAnthropicClient(): LlmClient {
  const client = new Anthropic();
  return {
    stream: (params, signal) => client.beta.messages.stream(params, { signal }),
    create: (params) => client.beta.messages.create(params),
  };
}

/** Turns SDK errors into messages that are safe and useful to show in the UI. */
export function describeLlmError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Anthropic rejected the API key. Check ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key doesn't have access to the configured model.";
  if (err instanceof Anthropic.NotFoundError) return "The configured model was not found. Check ANTHROPIC_MODEL.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API. Try again in a moment.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the Anthropic API.";
  if (err instanceof Anthropic.APIError) return `Anthropic API error (${err.status ?? "unknown"}): ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
