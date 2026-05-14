/**
 * Provider adapter registry (HEL-82).
 *
 * Maps provider names → adapter instances. tierRouter.invoke() looks up the
 * adapter for the resolved binding's provider and delegates the call.
 *
 * v1 ships Anthropic + OpenAI adapters. Gemini + Mistral land in follow-up
 * tickets (HEL-82.x) once the in-flight cross-model test surface needs them.
 */

import type { ProviderName } from "../../engine/llmProviders/types";
import type { ProviderAdapter } from "./types";
import { AnthropicAdapter } from "./anthropicAdapter";
import { OpenAIAdapter } from "./openaiAdapter";

const ADAPTERS: Partial<Record<ProviderName, ProviderAdapter>> = {
  anthropic: new AnthropicAdapter(),
  openai: new OpenAIAdapter(),
};

export function getProviderAdapter(provider: ProviderName): ProviderAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new Error(
      `Provider adapter not implemented for "${provider}". ` +
        `Supported in v1: ${Object.keys(ADAPTERS).join(", ")}. ` +
        `Gemini + Mistral adapters land in follow-up tickets.`,
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
