/**
 * Normalized provider-adapter contract (HEL-82).
 *
 * The rest of the platform writes against `NormalizedRequest` and reads
 * `NormalizedResponse`. Each provider has its own adapter that translates
 * between the normalized shape and the provider's wire format. This is the
 * abstraction that lets an agent on Claude Sonnet and an agent on GPT-4o
 * share the same tool registry, structured-output schema, and memory pool.
 */

import type { ProviderName } from "../../engine/llmProviders/types";

// ---------------------------------------------------------------------------
// Tools — universal shape per HEL-82
// ---------------------------------------------------------------------------

/** A JSON-Schema-shaped parameter spec. Provider adapters translate to the wire format. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema describing the tool's input parameters. */
  parameters: Record<string, unknown>;
}

export interface NormalizedToolCall {
  /** Provider's tool-call ID (Anthropic uses tool_use_id; OpenAI uses tool_call.id). */
  id: string;
  name: string;
  /** Already-parsed JSON arguments. Adapters parse from string before returning. */
  arguments: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type NormalizedMessageRole = "system" | "user" | "assistant" | "tool";

export interface NormalizedToolResult {
  /** ID of the tool_call this is responding to. */
  toolCallId: string;
  /** Result content the agent will see. */
  content: string;
  /** Optional flag to signal an error in the tool call. */
  isError?: boolean;
}

export interface NormalizedMessage {
  role: NormalizedMessageRole;
  /** For role=user/system/assistant — the text content. */
  content?: string;
  /** For role=assistant — tool calls the model made. */
  toolCalls?: NormalizedToolCall[];
  /** For role=tool — the tool_result block(s). */
  toolResults?: NormalizedToolResult[];
}

// ---------------------------------------------------------------------------
// Requests / responses
// ---------------------------------------------------------------------------

export interface NormalizedRequest {
  /** Provider+model resolved by the tier router. */
  provider: ProviderName;
  model: string;
  /** The conversation, including any prior tool results. */
  messages: NormalizedMessage[];
  /** Optional system prompt. Separated for providers (Anthropic) that take it as a dedicated field. */
  system?: string;
  /** Tools the model can call. */
  tools?: ToolSpec[];
  /**
   * Force a structured-output response that matches the given JSON Schema.
   * Different providers implement this differently — OpenAI has native
   * `response_format`, Anthropic uses a forced single-tool-call convention,
   * Gemini has function declarations. The adapter handles the translation.
   */
  responseSchema?: {
    name: string;
    schema: Record<string, unknown>;
  };
  /** Sampling controls. */
  maxTokens?: number;
  temperature?: number;
  /** Provider-specific overrides (region, endpoint, etc.) — adapter respects what it understands. */
  providerOptions?: Record<string, unknown>;
  /** API key / credentials. */
  apiKey?: string;
}

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  /** Cached portion of input tokens, when the provider reports it. */
  cachedInputTokens?: number;
}

export type NormalizedFinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "error"
  | "unknown";

export interface NormalizedResponse {
  /** Plain-text reply from the model. Empty when the model only emitted tool calls. */
  content: string;
  /** Tool calls the model wants to execute. */
  toolCalls: NormalizedToolCall[];
  usage: NormalizedUsage;
  finishReason: NormalizedFinishReason;
  /** True when the provider reports a meaningful cache hit on the input prefix. */
  cacheHit?: boolean;
  /** Raw provider response, in case callers need provider-specific fields. */
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface ProviderAdapter {
  /** Provider this adapter handles. */
  readonly provider: ProviderName;
  /** Translate + send a normalized request, return a normalized response. */
  invoke(request: NormalizedRequest): Promise<NormalizedResponse>;
}
