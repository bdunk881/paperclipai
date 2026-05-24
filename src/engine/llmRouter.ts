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
    lite: "gpt-5-nano",
    standard: "gpt-5.5",
    power: "gpt-5.5-pro",
  },
  gemini: {
    lite: "gemini-3.1-flash-lite",
    standard: "gemini-3.5-flash",
    power: "gemini-2.5-pro",
  },
  mistral: {
    lite: "mistral-small-latest",
    standard: "mistral-medium-latest",
    power: "mistral-large-latest",
  },
  bedrock: {
    lite: "amazon.nova-micro-v1:0",
    standard: "amazon.nova-lite-v1:0",
    power: "amazon.nova-premier-v1:0",
  },
  "vertex-ai": {
    lite: "gemini-2.5-flash",
    standard: "gemini-3.5-flash",
    power: "gemini-2.5-pro",
  },
  groq: {
    lite: "llama-3.1-8b-instant",
    standard: "meta-llama/llama-4-scout-17b-16e-instruct",
    power: "meta-llama/llama-4-maverick-17b-128e-instruct",
  },
  fireworks: {
    lite: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    standard: "accounts/fireworks/models/llama4-scout-instruct-basic",
    power: "accounts/fireworks/models/llama4-maverick-instruct-basic",
  },
  together: {
    lite: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    standard: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    power: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
  },
  ollama: {
    lite: "llama3.2",
    standard: "llama3.3:70b",
    power: "deepseek-r1:14b",
  },
  localai: {
    lite: "llama-3.2-3b-instruct",
    standard: "llama-3.1-8b-instruct",
    power: "llama-3.3-70b-instruct",
  },
  cohere: {
    lite: "command-r-plus-08-2024",
    standard: "command-a-03-2025",
    power: "command-a-plus-05-2026",
  },
  perplexity: {
    lite: "sonar",
    standard: "sonar-pro",
    power: "sonar-reasoning-pro",
  },
  xai: {
    lite: "grok-4.3",
    standard: "grok-4.3",
    power: "grok-4.3",
  },
  deepseek: {
    lite: "deepseek-v4-flash",
    standard: "deepseek-v4-flash",
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
  // Anthropic (per Anthropic's 2026-05 pricing page)
  "claude-opus-4-7":            { input: 0.005,     output: 0.025   },
  "claude-opus-4-6":            { input: 0.005,     output: 0.025   },
  "claude-sonnet-4-6":          { input: 0.003,     output: 0.015   },
  "claude-haiku-4-5":           { input: 0.001,     output: 0.005   },
  "claude-haiku-4-5-20251001":  { input: 0.001,     output: 0.005   },

  // OpenAI (per developers.openai.com pricing 2026-05)
  "gpt-5.5":                    { input: 0.005,     output: 0.030   },
  "gpt-5.5-pro":                { input: 0.030,     output: 0.180   },
  "gpt-5":                      { input: 0.00125,   output: 0.010   },
  "gpt-5-mini":                 { input: 0.00025,   output: 0.002   },
  "gpt-5-nano":                 { input: 0.00005,   output: 0.0004  },
  // Legacy GPT-4o rates retained so historical step_results cost out
  // correctly when older snapshots are queried.
  "gpt-4o":                     { input: 0.0025,    output: 0.01    },
  "gpt-4o-mini":                { input: 0.00015,   output: 0.0006  },

  // Gemini (per ai.google.dev pricing 2026-05)
  "gemini-3.5-flash":           { input: 0.00050,   output: 0.003   },
  "gemini-3.1-pro-preview":     { input: 0.002,     output: 0.012   },
  "gemini-3.1-flash-lite":      { input: 0.00025,   output: 0.0015  },
  "gemini-2.5-pro":             { input: 0.00125,   output: 0.005   },
  "gemini-2.5-flash":           { input: 0.00010,   output: 0.0004  },
  // Legacy
  "gemini-1.5-flash":           { input: 0.000075,  output: 0.0003  },
  "gemini-2.0-flash":           { input: 0.0001,    output: 0.0004  },
  "gemini-1.5-pro":             { input: 0.00125,   output: 0.005   },

  // Mistral
  "mistral-large-latest":       { input: 0.0005,    output: 0.0015  },
  "mistral-medium-latest":      { input: 0.0004,    output: 0.002   },
  "mistral-small-latest":       { input: 0.0001,    output: 0.0003  },

  // xAI Grok (per docs.x.ai pricing 2026-05)
  "grok-4.3":                   { input: 0.00125,   output: 0.0025  },

  // DeepSeek V4 (cache-miss rates; cache-hit pricing is ~10×–250× lower)
  "deepseek-v4-pro":            { input: 0.00174,   output: 0.00348 },
  "deepseek-v4-flash":          { input: 0.00014,   output: 0.00028 },
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
