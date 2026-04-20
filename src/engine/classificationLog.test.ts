import {
  clearClassificationDecisionsForTests,
  getClassificationDecisionLogCapacity,
  listClassificationDecisions,
  logClassificationDecision,
} from "./classificationLog";
import { extractPromptFeatures } from "./promptFeatures";

describe("classificationLog", () => {
  beforeEach(() => {
    clearClassificationDecisionsForTests();
  });

  afterEach(() => {
    clearClassificationDecisionsForTests();
  });

  it("stores decision entries with timestamp and required fields", () => {
    const features = extractPromptFeatures("Classify this", 80, 1);

    const logged = logClassificationDecision({
      promptHash: "abc123",
      features,
      selectedTier: "lite",
      confidenceScore: 0.8,
      modelId: "gpt-4o-mini",
    });

    expect(typeof logged.timestamp).toBe("string");
    expect(new Date(logged.timestamp).getTime()).not.toBeNaN();
    expect(logged.promptHash).toBe("abc123");
    expect(logged.selectedTier).toBe("lite");
    expect(logged.confidenceScore).toBe(0.8);
    expect(logged.modelId).toBe("gpt-4o-mini");
  });

  it("returns list in insertion order", () => {
    const features = extractPromptFeatures("Classify this", 80, 1);

    logClassificationDecision({
      promptHash: "first",
      features,
      selectedTier: "lite",
      confidenceScore: 0.7,
      modelId: "gpt-4o-mini",
    });
    logClassificationDecision({
      promptHash: "second",
      features,
      selectedTier: "standard",
      confidenceScore: 0.5,
      modelId: "gpt-4o",
    });

    const logs = listClassificationDecisions();
    expect(logs.map((entry) => entry.promptHash)).toEqual(["first", "second"]);
  });

  it("uses a positive ring-buffer capacity", () => {
    expect(getClassificationDecisionLogCapacity()).toBeGreaterThan(0);
  });
});
