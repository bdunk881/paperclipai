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
import { ProviderName } from "./llmProviders/types";

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
    power: "claude-opus-4-6",
  },
  openai: {
    lite: "gpt-4o-mini",
    standard: "gpt-4o",
    power: "gpt-4o",
  },
  gemini: {
    lite: "gemini-1.5-flash",
    standard: "gemini-2.0-flash",
    power: "gemini-1.5-pro",
  },
  mistral: {
    lite: "mistral-small-latest",
    standard: "mistral-large-latest",
    power: "mistral-large-latest",
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
  "claude-haiku-4-5-20251001":  { input: 0.00025,  output: 0.00125 },
  "claude-sonnet-4-6":          { input: 0.003,     output: 0.015   },
  "claude-opus-4-6":            { input: 0.015,     output: 0.075   },
  "gpt-4o-mini":                { input: 0.00015,   output: 0.0006  },
  "gpt-4o":                     { input: 0.0025,    output: 0.01    },
  "gemini-1.5-flash":           { input: 0.000075,  output: 0.0003  },
  "gemini-2.0-flash":           { input: 0.0001,    output: 0.0004  },
  "gemini-1.5-pro":             { input: 0.00125,   output: 0.005   },
  "mistral-small-latest":       { input: 0.0002,    output: 0.0006  },
  "mistral-large-latest":       { input: 0.002,     output: 0.006   },
};

// ---------------------------------------------------------------------------
// Complexity classifier (rule-based heuristics)
// ---------------------------------------------------------------------------

/**
 * Keywords in a prompt template that indicate a lightweight classification or
 * extraction task well-suited for the lite tier.
 */
const LITE_KEYWORDS = [
  "classify",
  "categorize",
  "extract",
  "identify",
  "label",
  "tag",
  "one of",
  "respond only with",
  "respond with a json",
  "yes or no",
  "true or false",
  "boolean",
];

/**
 * Keywords indicating complex, creative, or multi-step work that needs at
 * least the standard tier.
 */
const POWER_KEYWORDS = [
  "orchestrat",
  "plan ",
  "multi-agent",
  "multi agent",
  "coordinate",
  "synthesize",
  "comprehensive analysis",
  "detailed report",
];

/**
 * Classify the appropriate tier for an LLM step.
 *
 * Priority order:
 *  1. Explicit step-level override (`step.llmTier`)
 *  2. Agent steps → power (parallel orchestration)
 *  3. Large rendered prompt (> 2 000 chars) → power
 *  4. Short prompt + few output keys + lite keywords → lite
 *  5. Prompt contains power keywords → power
 *  6. Default → standard
 */
export function classifyTier(step: WorkflowStep, renderedPromptLength: number): LlmTier {
  // Explicit override always wins
  if (step.llmTier) return step.llmTier;

  // Agent steps are complex orchestration by nature
  if (step.kind === "agent") return "power";

  // Very large context requires the most capable model
  if (renderedPromptLength > 2000) return "power";

  const templateLower = (step.promptTemplate ?? "").toLowerCase();

  // Check for complexity signals first (power beats lite)
  if (POWER_KEYWORDS.some((kw) => templateLower.includes(kw))) return "power";

  // Short prompts with simple extraction/classification patterns → lite
  const hasLiteKeyword = LITE_KEYWORDS.some((kw) => templateLower.includes(kw));
  const fewOutputKeys = step.outputKeys.length <= 3;
  if (renderedPromptLength < 500 && fewOutputKeys && hasLiteKeyword) return "lite";

  return "standard";
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

/**
 * Return the model identifier for a given provider + tier.
 * Falls back to the provider's standard model if the tier has no mapping.
 */
export function resolveModelForTier(provider: ProviderName, tier: LlmTier): string {
  return TIER_MODELS[provider]?.[tier] ?? TIER_MODELS[provider]?.["standard"];
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
