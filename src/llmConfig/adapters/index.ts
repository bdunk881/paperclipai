/**
 * Provider adapter registry (HEL-82, HEL-224).
 *
 * Maps provider names → adapter instances. tierRouter.invoke() looks up the
 * adapter for the resolved binding's provider and delegates the call.
 *
 * Sixteen provider adapters live here:
 *   - Native shape:        Anthropic, OpenAI, Bedrock, Gemini, Mistral, Vertex AI, Cohere
 *   - OpenAI-compatible:   Groq, Fireworks, Together, xAI, Perplexity, DeepSeek,
 *                          Ollama, LocalAI, OpenCode Zen
 *
 * The OpenAI-compatible long-tail share a single parameterized adapter
 * class (`OpenAICompatibleAdapter`) — each provider registers one instance
 * with its own base URL. Adding a new OpenAI-compatible host is a one-line
 * change here, no new adapter file.
 */

import type { ProviderName } from "../../engine/llmProviders/types";
import type { ProviderAdapter } from "./types";
import { AnthropicAdapter } from "./anthropicAdapter";
import { BedrockAdapter } from "./bedrockAdapter";
import { CohereAdapter } from "./cohereAdapter";
import { GeminiAdapter } from "./geminiAdapter";
import { MistralAdapter } from "./mistralAdapter";
import { OpenAIAdapter } from "./openaiAdapter";
import { OpenAICompatibleAdapter } from "./openaiCompatibleAdapter";
import { VertexAdapter } from "./vertexAdapter";

const ADAPTERS: Partial<Record<ProviderName, ProviderAdapter>> = {
  // ─── Native wire formats ──────────────────────────────────────────────
  anthropic: new AnthropicAdapter(),
  openai: new OpenAIAdapter(),
  bedrock: new BedrockAdapter(),
  cohere: new CohereAdapter(),
  gemini: new GeminiAdapter(),
  mistral: new MistralAdapter(),
  "vertex-ai": new VertexAdapter(),
  // ─── OpenAI-compatible long-tail (HEL-224) ────────────────────────────
  groq: new OpenAICompatibleAdapter({
    provider: "groq",
    displayName: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
  }),
  fireworks: new OpenAICompatibleAdapter({
    provider: "fireworks",
    displayName: "Fireworks AI",
    baseUrl: "https://api.fireworks.ai/inference/v1",
  }),
  together: new OpenAICompatibleAdapter({
    provider: "together",
    displayName: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
  }),
  xai: new OpenAICompatibleAdapter({
    provider: "xai",
    displayName: "xAI",
    baseUrl: "https://api.x.ai/v1",
  }),
  perplexity: new OpenAICompatibleAdapter({
    provider: "perplexity",
    displayName: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
  }),
  deepseek: new OpenAICompatibleAdapter({
    provider: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
  }),
  ollama: new OpenAICompatibleAdapter({
    provider: "ollama",
    displayName: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    // Older Ollama builds ignore response_format json_schema; fall back
    // to prompt-only structured output.
    supportsResponseSchema: false,
  }),
  localai: new OpenAICompatibleAdapter({
    provider: "localai",
    displayName: "LocalAI",
    baseUrl: "http://127.0.0.1:8080/v1",
    supportsResponseSchema: false,
  }),
  opencode_zen: new OpenAICompatibleAdapter({
    provider: "opencode_zen",
    displayName: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
  }),
};

export function getProviderAdapter(provider: ProviderName): ProviderAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new Error(
      `Provider adapter not implemented for "${provider}". ` +
        `Supported today: ${Object.keys(ADAPTERS).join(", ")}.`,
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
