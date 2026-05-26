/**
 * runAgent — single entry point for an autonomous agent turn.
 *
 * Resolves the workspace's LLM credential, picks a backend by provider +
 * env flag, runs the agent loop, returns the unified result shape. All
 * callers (`runAgentTurn`, future direct callers) should go through here
 * rather than poking provider SDKs / adapters directly.
 *
 * Backend selection:
 *   - When AUTOFLOW_AGENT_SDK_ENABLED is set AND provider is anthropic →
 *     ClaudeSdkBackend (native Claude Agent SDK).
 *   - When AUTOFLOW_AGENT_SDK_ENABLED is set AND provider is openai →
 *     OpenAIAgentsBackend (native OpenAI Agents SDK).
 *   - Otherwise → FallbackAgentBackend (our adapter-based loop). This is
 *     the default; it preserves the existing, battle-tested behavior
 *     across every provider while the SDK paths are validated.
 *
 * Credential resolution mirrors the legacy `runAgentTurn` path so the
 * BYOK + tier-router story doesn't change at all from a caller's POV.
 */

import { llmConfigStore } from "../../llmConfig/llmConfigStore";
import { resolveModelForTier } from "../../engine/llmRouter";
import type { ProviderName } from "../../engine/llmProviders/types";
import { ClaudeSdkBackend } from "./claudeSdkBackend";
import { FallbackAgentBackend } from "./fallbackAgentBackend";
import { OpenAIAgentsBackend } from "./openaiAgentsBackend";
import type {
  AgentBackend,
  AgentBackendName,
  AgentRunInput,
  AgentRunResult,
  ResolvedModelBinding,
} from "./types";

const SDK_FLAG_ENV = "AUTOFLOW_AGENT_SDK_ENABLED";

/** Lazily instantiated singletons — backends are cheap but loading the SDKs isn't. */
const fallbackBackend = new FallbackAgentBackend();
let claudeSdkBackend: ClaudeSdkBackend | null = null;
let openAIAgentsBackend: OpenAIAgentsBackend | null = null;

function getClaudeSdkBackend(): ClaudeSdkBackend {
  if (!claudeSdkBackend) claudeSdkBackend = new ClaudeSdkBackend();
  return claudeSdkBackend;
}

function getOpenAIAgentsBackend(): OpenAIAgentsBackend {
  if (!openAIAgentsBackend) openAIAgentsBackend = new OpenAIAgentsBackend();
  return openAIAgentsBackend;
}

export function isAgentSdkEnabled(): boolean {
  const flag = process.env[SDK_FLAG_ENV];
  return flag === "1" || flag === "true";
}

export function pickBackend(provider: ProviderName): AgentBackend {
  if (isAgentSdkEnabled()) {
    if (provider === "anthropic") return getClaudeSdkBackend();
    if (provider === "openai") return getOpenAIAgentsBackend();
  }
  return fallbackBackend;
}

export function backendNameFor(provider: ProviderName): AgentBackendName {
  return pickBackend(provider).name;
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const binding = await resolveBinding(input);
  const backend = pickBackend(binding.provider);
  return backend.run(input, binding);
}

/**
 * Resolves the active LLM credential + tier-routed model for a run.
 * Mirrors the lookup `runAgentTurn` was doing inline so the new runtime
 * is a drop-in replacement.
 */
async function resolveBinding(input: AgentRunInput): Promise<ResolvedModelBinding> {
  const resolved = await llmConfigStore.getDecryptedDefault(input.userId);
  if (!resolved) {
    throw new Error(
      "No LLM provider configured for this workspace. Connect one in Settings → Models.",
    );
  }
  const model = resolveModelForTier(resolved.config.provider, input.tier ?? "standard");
  if (!resolved.apiKey) {
    throw new Error(
      `LLM credential for provider ${resolved.config.provider} has no decrypted API key.`,
    );
  }
  return {
    provider: resolved.config.provider,
    model,
    apiKey: resolved.apiKey,
  };
}
