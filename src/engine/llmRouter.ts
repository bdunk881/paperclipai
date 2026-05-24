/**
 * LLM tier router for AutoFlow.
 *
 * Selects the cheapest model capable of handling a given task by classifying
 * step complexity into one of three tiers:
 *
 *   lite     — short classification / entity-extraction / yes-no decisions
 *   standard — multi-step reasoning, NL→workflow translation, content generation
 *   power    — complex orchestration, large-context analysis, multi-agent planning
 *
 * Each tier maps to a cost-appropriate model per provider, so the same API key
 * works — only the `model` field changes.
 */

import { WorkflowStep } from "../types/workflow";
import { ProviderName, PROVIDER_MODELS } from "./llmProviders/types";
import { extractPromptFeatures, scorePromptTier, PromptTierScore } from "./promptFeatures";

export type LlmTier = "lite" | "standard" | "power";

export interface LlmCostLog {
  modelTier: LlmTier;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
}

// ---------------------------------------------------------------------------
// Tier → model mappings per provider
// ---------------------------------------------------------------------------

export const TIER_MODELS: Record<ProviderName, Record<LlmTier, string>> = {
  anthropic: {
    lite: "claude-haiku-4-5-20251001",
    standard: "claude-sonnet-4-6",
    power: "claude-opus-4-7",
  },
  openai: {
    lite: "gpt-5.4-nano",
    standard: "gpt-5.4",
    power: "gpt-5.5",
  },
  gemini: {
    lite: "gemini-3.1-flash-lite",
    standard: "gemini-3.5-flash",
    power: "gemini-3.1-pro-preview",
  },
  mistral: {
    lite: "mistral-small-latest",
    standard: "mistral-medium-3.5",
    power: "mistral-large-latest",
  },
  bedrock: {
    lite: "anthropic.claude-haiku-4-5-20251001-v1:0",
    standard: "anthropic.claude-sonnet-4-6",
    power: "anthropic.claude-opus-4-7",
  },
  "vertex-ai": {
    lite: "gemini-3.1-flash-lite",
    standard: "gemini-3.5-flash",
    power: "gemini-3.1-pro-preview",
  },
  groq: {
    lite: "meta-llama/llama-4-scout-17b-16e-instruct",
    standard: "qwen/qwen3-32b",
    power: "openai/gpt-oss-120b",
  },
  fireworks: {
    lite: "accounts/fireworks/models/qwen3p5-9b",
    standard: "accounts/fireworks/models/qwen3-32b",
    power: "accounts/fireworks/models/gpt-oss-120b",
  },
  together: {
    lite: "Qwen/Qwen3.5-9B",
    standard: "Qwen/Qwen3.5-397B-A17B",
    power: "deepseek-ai/DeepSeek-V4-Pro",
  },
  ollama: {
    lite: "gpt-oss:20b",
    standard: "qwen3.6:27b",
    power: "llama4:scout",
  },
  localai: {
    lite: "gpt-oss-20b",
    standard: "qwen3.6-27b",
    power: "qwen3.6-35b-a3b",
  },
  cohere: {
    lite: "command-r7b-12-2024",
    standard: "command-a-03-2025",
    power: "command-a-plus-05-2026",
  },
  perplexity: {
    lite: "sonar",
    standard: "sonar-pro",
    power: "sonar-deep-research",
  },
  xai: {
    lite: "grok-4.20-non-reasoning",
    standard: "grok-4.3",
    power: "grok-4.3",
  },
  deepseek: {
    lite: "deepseek-v4-flash",
    standard: "deepseek-v4-pro",
    power: "deepseek-v4-pro",
  },
  opencode_zen: {
    // Hosted free tier provider has a single stealth model — use it for
    // every tier so the engine's classifier doesn't accidentally pick
    // an unknown opencode-zen model.
    lite: "big-pickle",
    standard: "big-pickle",
    power: "big-pickle",
  },
};

// ---------------------------------------------------------------------------
// Per-model cost rates (USD per 1 000 tokens)
// ---------------------------------------------------------------------------

interface TokenCostRate {
  input: number;
  output: number;
}

const MODEL_COST_RATES: Record<string, TokenCostRate> = {
  "claude-haiku-4-5-20251001":  { input: 0.001,    output: 0.005   },
  "claude-sonnet-4-6":          { input: 0.003,     output: 0.015   },
  "claude-opus-4-7":            { input: 0.005,     output: 0.025   },
  "gpt-5.4-nano":               { input: 0.0002,    output: 0.00125 },
  "gpt-5.4":                    { input: 0.0025,    output: 0.015   },
  "gpt-5.5":                    { input: 0.005,     output: 0.03    },
  "gemini-3.1-flash-lite":      { input: 0.00045,   output: 0.0027  },
  "gemini-3.5-flash":           { input: 0.0015,    output: 0.009   },
  "gemini-3.1-pro-preview":     { input: 0.002,     output: 0.012   },
  "mistral-small-latest":       { input: 0.00015,   output: 0.0006  },
  "mistral-medium-3.5":         { input: 0.0015,    output: 0.0075  },
  "mistral-large-latest":       { input: 0.0005,    output: 0.0015  },
};

// ---------------------------------------------------------------------------
// Complexity classifier (feature-based weighted scoring)
// ---------------------------------------------------------------------------

/**
 * Classify the appropriate tier for an LLM step.
 *
 * Priority order:
 *  1. Explicit step-level override (`step.llmTier`)
 *  2. Agent steps → power (parallel orchestration)
 *  3. Feature extraction + weighted scoring
 *  4. Low-confidence fallback → standard
 */
export function classifyTier(step: WorkflowStep, renderedPromptLength: number): LlmTier {
  return classifyTierWithConfidence(step, renderedPromptLength).tier;
}

/**
 * Returns the tier decision plus confidence and feature/score breakdown.
 */
export function classifyTierWithConfidence(step: WorkflowStep, renderedPromptLength: number): PromptTierScore {
  // Explicit override always wins
  if (step.llmTier) {
    return {
      tier: step.llmTier,
      confidence: 1,
      scores: {
        lite: step.llmTier === "lite" ? 1 : 0,
        standard: step.llmTier === "standard" ? 1 : 0,
        power: step.llmTier === "power" ? 1 : 0,
      },
      features: extractPromptFeatures(step.promptTemplate ?? "", renderedPromptLength, step.outputKeys.length),
      usedFallback: false,
    };
  }

  // Agent steps are complex orchestration by nature
  if (step.kind === "agent") {
    return {
      tier: "power",
      confidence: 1,
      scores: { lite: 0, standard: 0, power: 1 },
      features: extractPromptFeatures(step.promptTemplate ?? "", renderedPromptLength, step.outputKeys.length),
      usedFallback: false,
    };
  }

  const features = extractPromptFeatures(step.promptTemplate ?? "", renderedPromptLength, step.outputKeys.length);
  return scorePromptTier(features);
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

/**
 * Return the model identifier for a given provider + tier.
 * Falls back to the provider's standard model if the tier has no mapping.
 */
export function resolveModelForTier(provider: ProviderName, tier: LlmTier): string {
  return TIER_MODELS[provider]?.[tier]
    ?? TIER_MODELS[provider]?.standard
    ?? PROVIDER_MODELS[provider]?.[0]
    ?? PROVIDER_MODELS.openai[0];
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

/**
 * Estimate the USD cost for a completed LLM call.
 * Returns 0 if the model is not in the cost table.
 */
export function estimateCost(
  modelId: string,
  promptTokens: number,
  completionTokens: number
): number {
  const rate = MODEL_COST_RATES[modelId];
  if (!rate) return 0;
  return (promptTokens / 1000) * rate.input + (completionTokens / 1000) * rate.output;
}

/**
 * Build a complete LlmCostLog from the routing decision and token counts.
 */
export function buildCostLog(
  tier: LlmTier,
  modelId: string,
  promptTokens: number,
  completionTokens: number
): LlmCostLog {
  return {
    modelTier: tier,
    modelId,
    promptTokens,
    completionTokens,
    estimatedCostUsd: estimateCost(modelId, promptTokens, completionTokens),
  };
}
