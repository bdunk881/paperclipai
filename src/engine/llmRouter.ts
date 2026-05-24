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
    lite: "gpt-4.1-mini",
    standard: "gpt-4.1",
    power: "o3",
  },
  gemini: {
    lite: "gemini-2.5-flash-lite",
    standard: "gemini-2.5-flash",
    power: "gemini-2.5-pro",
  },
  mistral: {
    lite: "mistral-small-latest",
    standard: "mistral-large-latest",
    power: "mistral-large-latest",
  },
  bedrock: {
    lite: "amazon.nova-2-lite-v1:0",
    standard: "amazon.nova-pro-v1:0",
    power: "anthropic.claude-opus-4-7",
  },
  "vertex-ai": {
    lite: "gemini-2.5-flash-lite",
    standard: "gemini-2.5-flash",
    power: "gemini-2.5-pro",
  },
  groq: {
    lite: "llama-3.1-8b-instant",
    standard: "meta-llama/llama-4-scout-17b-16e-instruct",
    power: "llama-3.3-70b-versatile",
  },
  fireworks: {
    lite: "accounts/fireworks/models/llama4-scout-instruct-basic",
    standard: "accounts/fireworks/models/llama4-maverick-instruct-basic",
    power: "accounts/fireworks/models/llama4-maverick-instruct-basic",
  },
  together: {
    lite: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
    standard: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    power: "deepseek-ai/DeepSeek-V3",
  },
  ollama: {
    lite: "llama3.2",
    standard: "llama4:scout",
    power: "llama3.3:70b",
  },
  localai: {
    lite: "llama-3.2-3b-instruct",
    standard: "llama-3.1-8b-instruct",
    power: "llama-3.1-70b-instruct",
  },
  cohere: {
    lite: "command-r7b-12-2024",
    standard: "command-a-03-2025",
    power: "command-a-plus-05-2026",
  },
  perplexity: {
    lite: "sonar",
    standard: "sonar-pro",
    power: "sonar-reasoning-pro",
  },
  xai: {
    lite: "grok-4.20-0309-non-reasoning",
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
  // Anthropic Claude 4 family (USD per 1K tokens)
  "claude-haiku-4-5-20251001":  { input: 0.00080,  output: 0.004   },
  "claude-sonnet-4-6":          { input: 0.003,    output: 0.015   },
  "claude-opus-4-6":            { input: 0.015,    output: 0.075   },
  "claude-opus-4-7":            { input: 0.005,    output: 0.025   },
  // OpenAI GPT-4.1 family
  "gpt-4.1-nano":               { input: 0.0001,   output: 0.0004  },
  "gpt-4.1-mini":               { input: 0.00040,  output: 0.0016  },
  "gpt-4.1":                    { input: 0.002,    output: 0.008   },
  "o4-mini":                    { input: 0.0011,   output: 0.0044  },
  "o3":                         { input: 0.01,     output: 0.04    },
  // Legacy OpenAI (kept for existing workspace configs)
  "gpt-4o-mini":                { input: 0.00015,  output: 0.0006  },
  "gpt-4o":                     { input: 0.0025,   output: 0.01    },
  // Google Gemini 2.5 family
  "gemini-2.5-flash-lite":      { input: 0.000075, output: 0.0003  },
  "gemini-2.5-flash":           { input: 0.0003,   output: 0.0012  },
  "gemini-2.5-pro":             { input: 0.00125,  output: 0.01    },
  // Legacy Gemini (kept for existing workspace configs)
  "gemini-2.0-flash":           { input: 0.0001,   output: 0.0004  },
  "gemini-1.5-flash":           { input: 0.000075, output: 0.0003  },
  "gemini-1.5-pro":             { input: 0.00125,  output: 0.005   },
  // Mistral
  "mistral-small-latest":       { input: 0.00015,  output: 0.0006  },
  "mistral-large-latest":       { input: 0.0005,   output: 0.0015  },
  // xAI Grok 4
  "grok-4.3":                   { input: 0.00125,  output: 0.0025  },
  "grok-4.20-0309-non-reasoning": { input: 0.00125, output: 0.0025 },
  // DeepSeek V4
  "deepseek-v4-flash":          { input: 0.00014,  output: 0.00028 },
  "deepseek-v4-pro":            { input: 0.000435, output: 0.00087 },
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
