import {
  clearClassificationDecisionsForTests,
  getClassificationDecisionLogCapacity,
  listClassificationDecisions,
  listClassificationDecisionsForWorkspace,
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
      workspaceId: "workspace-a",
      promptHash: "abc123",
      features,
      selectedTier: "lite",
      confidenceScore: 0.8,
      modelId: "gpt-4o-mini",
    });

    expect(typeof logged.timestamp).toBe("string");
    expect(new Date(logged.timestamp).getTime()).not.toBeNaN();
    expect(logged.workspaceId).toBe("workspace-a");
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

  it("list() returns a copy that does not mutate internal state", () => {
    const features = extractPromptFeatures("Classify this", 80, 1);
    logClassificationDecision({
      promptHash: "only",
      features,
      selectedTier: "lite",
      confidenceScore: 0.5,
      modelId: "gpt-4o-mini",
    });

    const snapshot = listClassificationDecisions();
    expect(snapshot).toHaveLength(1);
    snapshot.push({
      timestamp: new Date().toISOString(),
      promptHash: "injected",
      features,
      selectedTier: "lite",
      confidenceScore: 0,
      modelId: "fake",
    });
    snapshot.pop();
    snapshot.length = 0;

    const fresh = listClassificationDecisions();
    expect(fresh).toHaveLength(1);
    expect(fresh[0].promptHash).toBe("only");
    expect(fresh).not.toBe(snapshot);
  });

  it("can return only decisions logged for a workspace", () => {
    const features = extractPromptFeatures("Classify this", 80, 1);
    logClassificationDecision({
      workspaceId: "workspace-a",
      promptHash: "a-1",
      features,
      selectedTier: "lite",
      confidenceScore: 0.8,
      modelId: "gpt-4o-mini",
    });
    logClassificationDecision({
      workspaceId: "workspace-b",
      promptHash: "b-1",
      features,
      selectedTier: "standard",
      confidenceScore: 0.6,
      modelId: "gpt-4o",
    });
    logClassificationDecision({
      promptHash: "unscoped",
      features,
      selectedTier: "lite",
      confidenceScore: 0.5,
      modelId: "gpt-4o-mini",
    });

    expect(listClassificationDecisionsForWorkspace("workspace-a").map((entry) => entry.promptHash)).toEqual(["a-1"]);
    expect(listClassificationDecisionsForWorkspace("workspace-b").map((entry) => entry.promptHash)).toEqual(["b-1"]);
  });

  it("clearClassificationDecisionsForTests() empties the buffer", () => {
    const features = extractPromptFeatures("Classify this", 80, 1);
    logClassificationDecision({
      promptHash: "a",
      features,
      selectedTier: "lite",
      confidenceScore: 0.5,
      modelId: "gpt-4o-mini",
    });
    logClassificationDecision({
      promptHash: "b",
      features,
      selectedTier: "lite",
      confidenceScore: 0.5,
      modelId: "gpt-4o-mini",
    });
    expect(listClassificationDecisions()).toHaveLength(2);

    clearClassificationDecisionsForTests();
    expect(listClassificationDecisions()).toEqual([]);
  });
});

describe("classificationLog ring-buffer capacity from env", () => {
  const ENV_KEY = "CLASSIFICATION_LOG_RING_BUFFER_SIZE";
  const originalValue = process.env[ENV_KEY];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalValue;
    }
    jest.resetModules();
  });

  function loadFresh(envValue: string | undefined): typeof import("./classificationLog") {
    if (envValue === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = envValue;
    }
    let mod!: typeof import("./classificationLog");
    jest.isolateModules(() => {
      mod = require("./classificationLog") as typeof import("./classificationLog");
    });
    return mod;
  }

  it("defaults to 1000 when env var is unset", () => {
    const mod = loadFresh(undefined);
    expect(mod.getClassificationDecisionLogCapacity()).toBe(1000);
  });

  it("defaults to 1000 when env var is non-numeric", () => {
    const mod = loadFresh("not-a-number");
    expect(mod.getClassificationDecisionLogCapacity()).toBe(1000);
  });

  it("defaults to 1000 when env var is zero", () => {
    const mod = loadFresh("0");
    expect(mod.getClassificationDecisionLogCapacity()).toBe(1000);
  });

  it("defaults to 1000 when env var is negative", () => {
    const mod = loadFresh("-42");
    expect(mod.getClassificationDecisionLogCapacity()).toBe(1000);
  });

  it("defaults to 1000 when env var is empty string", () => {
    const mod = loadFresh("");
    expect(mod.getClassificationDecisionLogCapacity()).toBe(1000);
  });

  it("uses the parsed integer when env var is a valid positive number", () => {
    const mod = loadFresh("5");
    expect(mod.getClassificationDecisionLogCapacity()).toBe(5);
  });

  it("evicts oldest entries when capacity is reached", () => {
    const mod = loadFresh("3");
    const features = extractPromptFeatures("Classify this", 80, 1);

    for (const hash of ["one", "two", "three", "four", "five"]) {
      mod.logClassificationDecision({
        promptHash: hash,
        features,
        selectedTier: "lite",
        confidenceScore: 0.5,
        modelId: "gpt-4o-mini",
      });
    }

    const logs = mod.listClassificationDecisions();
    expect(logs).toHaveLength(3);
    expect(logs.map((entry) => entry.promptHash)).toEqual(["three", "four", "five"]);
  });

  it("clamps fractional capacities via floor and respects min of 1", () => {
    const mod = loadFresh("1");
    expect(mod.getClassificationDecisionLogCapacity()).toBe(1);

    const features = extractPromptFeatures("Classify this", 80, 1);
    mod.logClassificationDecision({
      promptHash: "first",
      features,
      selectedTier: "lite",
      confidenceScore: 0.5,
      modelId: "gpt-4o-mini",
    });
    mod.logClassificationDecision({
      promptHash: "second",
      features,
      selectedTier: "lite",
      confidenceScore: 0.5,
      modelId: "gpt-4o-mini",
    });

    const logs = mod.listClassificationDecisions();
    expect(logs).toHaveLength(1);
    expect(logs[0].promptHash).toBe("second");
  });
});
