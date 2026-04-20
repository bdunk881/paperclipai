import {
  extractPromptFeatures,
  scorePromptTier,
  DEFAULT_PROMPT_TIER_SCORING_CONFIG,
} from "./promptFeatures";

describe("extractPromptFeatures", () => {
  it("extracts structural complexity signals", () => {
    const prompt = [
      "First analyze the request.",
      "Then provide output.",
      "- include bullet one",
      "```ts",
      "console.log('hi');",
      "```",
      "Respond only with JSON.",
    ].join("\n");
    const features = extractPromptFeatures(prompt, prompt.length, 2);
    expect(features.hasMultiStepInstructions).toBe(true);
    expect(features.hasLists).toBe(true);
    expect(features.hasCodeBlock).toBe(true);
    expect(features.requiresStructuredOutput).toBe(true);
  });

  it("detects explicit structured examples", () => {
    const prompt = [
      "Respond with JSON using this shape:",
      '{"customer":{"name":"string","plan":"string","active":true}}',
    ].join("\n");
    const features = extractPromptFeatures(prompt, prompt.length, 1);
    expect(features.hasStructuredExample).toBe(true);
  });

  it("detects plain YAML examples", () => {
    const prompt = [
      "Respond with YAML using this shape:",
      "customer: active",
      "plan: pro",
    ].join("\n");
    const features = extractPromptFeatures(prompt, prompt.length, 1);
    expect(features.hasStructuredExample).toBe(true);
  });

  it("detects domain signals", () => {
    const codePrompt = "Refactor this Python function and explain the algorithm.";
    const analysisPrompt = "Analyze this dataset trend and report key correlations.";
    const creativePrompt = "Write a creative story in our brand voice.";
    const qaPrompt = "Classify this text and answer yes or no.";

    expect(extractPromptFeatures(codePrompt, codePrompt.length, 1).domainCodeGeneration).toBe(true);
    expect(extractPromptFeatures(analysisPrompt, analysisPrompt.length, 1).domainDataAnalysis).toBe(true);
    expect(extractPromptFeatures(creativePrompt, creativePrompt.length, 1).domainCreativeWriting).toBe(true);
    expect(extractPromptFeatures(qaPrompt, qaPrompt.length, 1).domainSimpleQa).toBe(true);
  });
});

describe("scorePromptTier", () => {
  it("scores simple short prompts toward lite", () => {
    const prompt = "Classify this message and answer yes or no. Respond only with JSON.";
    const features = extractPromptFeatures(prompt, prompt.length, 1);
    const result = scorePromptTier(features);
    expect(result.tier).toBe("lite");
    expect(result.confidence).toBeGreaterThanOrEqual(DEFAULT_PROMPT_TIER_SCORING_CONFIG.confidenceThreshold);
  });

  it("scores complex code and analysis prompts toward power", () => {
    const prompt = [
      "First analyze this dataset and identify anomalies.",
      "Then refactor the TypeScript function below and explain your approach.",
      "```ts",
      "function score(events: number[]) { return events.reduce((a, b) => a + b, 0); }",
      "```",
    ].join("\n");
    const features = extractPromptFeatures(prompt, 4200, 4);
    const result = scorePromptTier(features);
    expect(result.tier).toBe("power");
  });

  it("falls back to standard when scores are too close", () => {
    const prompt = "Review this text and provide recommendations.";
    const features = extractPromptFeatures(prompt, prompt.length, 1);
    const result = scorePromptTier(features);
    expect(result.tier).toBe("standard");
    expect(result.usedFallback).toBe(true);
  });

  it("keeps short schema-heavy prompts out of lite", () => {
    const prompt = [
      "Return JSON using this schema:",
      '{"customer":{"name":"string","plan":"string","active":true}}',
    ].join("\n");
    const features = extractPromptFeatures(prompt, prompt.length, 1);
    const result = scorePromptTier(features);
    expect(result.tier).toBe("standard");
    expect(result.usedFallback).toBe(false);
  });

  it("keeps short YAML example prompts out of lite", () => {
    const prompt = [
      "Return YAML using this shape:",
      "customer: active",
      "plan: pro",
    ].join("\n");
    const features = extractPromptFeatures(prompt, prompt.length, 1);
    const result = scorePromptTier(features);
    expect(result.tier).toBe("standard");
  });
});
