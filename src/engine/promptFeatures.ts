import { LlmTier } from "./llmRouter";

export interface PromptFeatures {
  tokenEstimate: number;
  isShortPrompt: boolean;
  isLongPrompt: boolean;
  hasLists: boolean;
  hasCodeBlock: boolean;
  hasMultiStepInstructions: boolean;
  hasStructuredExample: boolean;
  outputKeyCount: number;
  requiresStructuredOutput: boolean;
  domainCodeGeneration: boolean;
  domainDataAnalysis: boolean;
  domainCreativeWriting: boolean;
  domainSimpleQa: boolean;
}

export interface PromptTierWeights {
  lite: Record<string, number>;
  standard: Record<string, number>;
  power: Record<string, number>;
}

export interface PromptTierScoringConfig {
  confidenceThreshold: number;
  weights: PromptTierWeights;
}

export interface PromptTierScore {
  tier: LlmTier;
  confidence: number;
  scores: Record<LlmTier, number>;
  features: PromptFeatures;
  usedFallback: boolean;
}

const CODE_KEYWORDS = [
  "code",
  "function",
  "typescript",
  "python",
  "javascript",
  "sql",
  "debug",
  "refactor",
];

const ANALYSIS_KEYWORDS = [
  "analyze",
  "analysis",
  "trend",
  "correlation",
  "statistical",
  "dataset",
  "metrics",
  "report",
];

const CREATIVE_KEYWORDS = [
  "story",
  "creative",
  "poem",
  "brand voice",
  "rewrite",
  "tone",
  "narrative",
  "campaign",
];

const SIMPLE_QA_KEYWORDS = [
  "yes or no",
  "true or false",
  "one word",
  "classify",
  "classifier",
  "classification",
  "categorize",
  "extract",
  "label",
  "tag",
];

const STRUCTURED_OUTPUT_KEYWORDS = [
  "json",
  "yaml",
  "xml",
  "csv",
  "table",
  "schema",
  "respond only with",
  "structured",
];

const STRUCTURED_EXAMPLE_PATTERN =
  /```(?:json|yaml|xml)|\{[\s\S]{0,160}"[\w-]+"\s*:|<[\w-]+>[\s\S]{0,160}<\/[\w-]+>|(?:^|\n)\s*[\w-]+:\s+\S+(?:\n\s*[\w-]+:\s+\S+)+/i;

export const DEFAULT_PROMPT_TIER_SCORING_CONFIG: PromptTierScoringConfig = {
  confidenceThreshold: 0.2,
  weights: {
    lite: {
      isShortPrompt: 0.9,
      isLongPrompt: -1.6,
      hasLists: -0.4,
      hasCodeBlock: -0.9,
      hasMultiStepInstructions: -1.4,
      hasStructuredExample: -0.8,
      requiresStructuredOutput: 1.0,
      domainCodeGeneration: -1.1,
      domainDataAnalysis: -0.8,
      domainCreativeWriting: -0.8,
      domainSimpleQa: 2.4,
      outputKeyCount: -0.1,
    },
    standard: {
      isShortPrompt: 0.7,
      isLongPrompt: 0.3,
      hasLists: 0.5,
      hasCodeBlock: 0.4,
      hasMultiStepInstructions: 0.9,
      hasStructuredExample: 1.1,
      requiresStructuredOutput: 0.6,
      domainCodeGeneration: 0.7,
      domainDataAnalysis: 0.8,
      domainCreativeWriting: 0.9,
      domainSimpleQa: 0.2,
      outputKeyCount: 0.12,
    },
    power: {
      isShortPrompt: -0.3,
      isLongPrompt: 2.0,
      hasLists: 0.8,
      hasCodeBlock: 1.4,
      hasMultiStepInstructions: 2.4,
      hasStructuredExample: 0.5,
      requiresStructuredOutput: 0.3,
      domainCodeGeneration: 1.8,
      domainDataAnalysis: 2.0,
      domainCreativeWriting: 1.3,
      domainSimpleQa: -0.6,
      outputKeyCount: 0.2,
    },
  },
};

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function extractPromptFeatures(
  promptTemplate: string,
  renderedPromptLength: number,
  outputKeyCount: number
): PromptFeatures {
  const lowerPrompt = promptTemplate.toLowerCase();
  const tokenEstimate = Math.max(1, Math.round(renderedPromptLength / 4));
  const listPattern = /(^|\n)\s*(?:[-*]|\d+\.)\s+/m;
  const multiStepPattern =
    /(step\s+\d+|first[,:\s]|second[,:\s]|then[,:\s]|finally[,:\s]|before you|after you|multi-step)/i;

  return {
    tokenEstimate,
    isShortPrompt: tokenEstimate <= 140,
    isLongPrompt: tokenEstimate >= 700,
    hasLists: listPattern.test(promptTemplate),
    hasCodeBlock: /```/.test(promptTemplate),
    hasMultiStepInstructions: multiStepPattern.test(promptTemplate),
    hasStructuredExample: STRUCTURED_EXAMPLE_PATTERN.test(promptTemplate),
    outputKeyCount,
    requiresStructuredOutput: includesAny(lowerPrompt, STRUCTURED_OUTPUT_KEYWORDS),
    domainCodeGeneration: includesAny(lowerPrompt, CODE_KEYWORDS),
    domainDataAnalysis: includesAny(lowerPrompt, ANALYSIS_KEYWORDS),
    domainCreativeWriting: includesAny(lowerPrompt, CREATIVE_KEYWORDS),
    domainSimpleQa: includesAny(lowerPrompt, SIMPLE_QA_KEYWORDS),
  };
}

export function scorePromptTier(
  features: PromptFeatures,
  config: PromptTierScoringConfig = DEFAULT_PROMPT_TIER_SCORING_CONFIG
): PromptTierScore {
  const rawScores: Record<LlmTier, number> = {
    lite: 0,
    standard: 0.25,
    power: 0,
  };

  const tiers: LlmTier[] = ["lite", "standard", "power"];
  for (const tier of tiers) {
    const tierWeights = config.weights[tier];
    rawScores[tier] += Number(features.isShortPrompt) * (tierWeights.isShortPrompt ?? 0);
    rawScores[tier] += Number(features.isLongPrompt) * (tierWeights.isLongPrompt ?? 0);
    rawScores[tier] += Number(features.hasLists) * (tierWeights.hasLists ?? 0);
    rawScores[tier] += Number(features.hasCodeBlock) * (tierWeights.hasCodeBlock ?? 0);
    rawScores[tier] += Number(features.hasMultiStepInstructions) * (tierWeights.hasMultiStepInstructions ?? 0);
    rawScores[tier] += Number(features.hasStructuredExample) * (tierWeights.hasStructuredExample ?? 0);
    rawScores[tier] += Number(features.requiresStructuredOutput) * (tierWeights.requiresStructuredOutput ?? 0);
    rawScores[tier] += Number(features.domainCodeGeneration) * (tierWeights.domainCodeGeneration ?? 0);
    rawScores[tier] += Number(features.domainDataAnalysis) * (tierWeights.domainDataAnalysis ?? 0);
    rawScores[tier] += Number(features.domainCreativeWriting) * (tierWeights.domainCreativeWriting ?? 0);
    rawScores[tier] += Number(features.domainSimpleQa) * (tierWeights.domainSimpleQa ?? 0);
    rawScores[tier] += features.outputKeyCount * (tierWeights.outputKeyCount ?? 0);
  }

  const sorted = tiers
    .map((tier) => ({ tier, score: rawScores[tier] }))
    .sort((a, b) => b.score - a.score);

  const top = sorted[0];
  const second = sorted[1];
  const margin = top.score - second.score;
  const confidence = clamp(margin / 4, 0, 1);
  const usedFallback = confidence < config.confidenceThreshold;
  const resolvedTier: LlmTier = usedFallback ? "standard" : top.tier;

  return {
    tier: resolvedTier,
    confidence,
    scores: rawScores,
    features,
    usedFallback,
  };
}
