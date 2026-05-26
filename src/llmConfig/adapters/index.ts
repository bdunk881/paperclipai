/**
 * Provider adapter registry (HEL-82).
 *
 * Maps provider names → adapter instances. tierRouter.invoke() looks up the
 * adapter for the resolved binding's provider and delegates the call.
 *
 * Six provider adapters are wired today: Anthropic, OpenAI, Bedrock, Gemini,
 * Mistral, and Vertex AI. The OpenAI-compatible long-tail (groq, fireworks,
 * together, xai, perplexity, deepseek, ollama, localai, opencode_zen) and
 * Cohere still route through the legacy `engine/llmProviders/*` path until a
 * follow-up ticket folds them in.
 */

import type { ProviderName } from "../../engine/llmProviders/types";
import type { ProviderAdapter } from "./types";
import { AnthropicAdapter } from "./anthropicAdapter";
import { BedrockAdapter } from "./bedrockAdapter";
import { GeminiAdapter } from "./geminiAdapter";
import { MistralAdapter } from "./mistralAdapter";
import { OpenAIAdapter } from "./openaiAdapter";
import { VertexAdapter } from "./vertexAdapter";

const ADAPTERS: Partial<Record<ProviderName, ProviderAdapter>> = {
  anthropic: new AnthropicAdapter(),
  openai: new OpenAIAdapter(),
  bedrock: new BedrockAdapter(),
  gemini: new GeminiAdapter(),
  mistral: new MistralAdapter(),
  "vertex-ai": new VertexAdapter(),
};

export function getProviderAdapter(provider: ProviderName): ProviderAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new Error(
      `Provider adapter not implemented for "${provider}". ` +
        `Supported today: ${Object.keys(ADAPTERS).join(", ")}. ` +
        `Cohere and the OpenAI-compatible long-tail still go through the legacy provider path.`,
    );
  }
  return adapter;
}

export function getSupportedAdapterProviders(): ProviderName[] {
  return Object.keys(ADAPTERS) as ProviderName[];
}

export type {
  NormalizedRequest,
  NormalizedResponse,
  NormalizedToolCall,
  NormalizedMessage,
  NormalizedToolResult,
  NormalizedUsage,
  NormalizedFinishReason,
  ProviderAdapter,
  ToolSpec,
} from "./types";
