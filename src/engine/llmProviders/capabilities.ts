/**
 * Per-provider streaming capabilities for live agent trace.
 */

import type { ProviderName } from "./types";

export interface ProviderStreamCapabilities {
  streamText: boolean;
  streamTools: boolean;
  streamToolArgs: boolean;
  streamReasoning: boolean;
}

const OPENAI_COMPAT: ProviderStreamCapabilities = {
  streamText: true,
  streamTools: true,
  streamToolArgs: true,
  streamReasoning: true,
};

const ANTHROPIC_CAP: ProviderStreamCapabilities = {
  streamText: true,
  streamTools: true,
  streamToolArgs: true,
  streamReasoning: true,
};

const GEMINI_CAP: ProviderStreamCapabilities = {
  streamText: true,
  streamTools: true,
  streamToolArgs: false,
  streamReasoning: true,
};

const MISTRAL_CAP: ProviderStreamCapabilities = {
  streamText: true,
  streamTools: true,
  streamToolArgs: true,
  streamReasoning: false,
};

const NONE: ProviderStreamCapabilities = {
  streamText: false,
  streamTools: false,
  streamToolArgs: false,
  streamReasoning: false,
};

const SYNTHETIC: ProviderStreamCapabilities = {
  streamText: false,
  streamTools: false,
  streamToolArgs: false,
  streamReasoning: false,
};

export const PROVIDER_STREAM_CAPABILITIES: Record<ProviderName, ProviderStreamCapabilities> = {
  openai: OPENAI_COMPAT,
  anthropic: ANTHROPIC_CAP,
  gemini: GEMINI_CAP,
  mistral: MISTRAL_CAP,
  bedrock: { streamText: true, streamTools: true, streamToolArgs: true, streamReasoning: false },
  "vertex-ai": GEMINI_CAP,
  groq: OPENAI_COMPAT,
  fireworks: OPENAI_COMPAT,
  together: OPENAI_COMPAT,
  ollama: OPENAI_COMPAT,
  localai: OPENAI_COMPAT,
  cohere: { streamText: true, streamTools: true, streamToolArgs: true, streamReasoning: false },
  perplexity: OPENAI_COMPAT,
  xai: OPENAI_COMPAT,
  deepseek: OPENAI_COMPAT,
  opencode_zen: OPENAI_COMPAT,
  openrouter: OPENAI_COMPAT,
};

export function getProviderStreamCapabilities(
  provider: ProviderName,
): ProviderStreamCapabilities {
  return PROVIDER_STREAM_CAPABILITIES[provider] ?? SYNTHETIC;
}

/** True when the provider can stream a full agentic tool loop natively. */
export function providerSupportsNativeAgentStream(provider: ProviderName): boolean {
  const cap = getProviderStreamCapabilities(provider);
  return cap.streamText && cap.streamTools;
}
