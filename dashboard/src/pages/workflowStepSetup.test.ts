import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";
import type { WorkflowStep } from "../types/workflow";
import {
  buildStepSetupContext,
  evaluateStepReadiness,
  getStepOutcomeSubtitle,
  getStepSuggestedNextSteps,
  getWorkflowSuggestedNextSteps,
  isDefaultStepName,
  validateCronExpression,
} from "./workflowStepSetup";

const kindLabel = (kind: string) => kind;

function step(overrides: Partial<WorkflowStep> & Pick<WorkflowStep, "id" | "kind">): WorkflowStep {
  return {
    id: overrides.id,
    kind: overrides.kind,
    name: overrides.name ?? "LLM Step",
    description: overrides.description ?? "",
    inputKeys: overrides.inputKeys ?? [],
    outputKeys: overrides.outputKeys ?? [],
    ...overrides,
  };
}

describe("workflowStepSetup", () => {
  it("flags default step names", () => {
    expect(isDefaultStepName(step({ id: "1", kind: "llm", name: "LLM Step" }), "LLM")).toBe(true);
    expect(isDefaultStepName(step({ id: "1", kind: "llm", name: "Classify ticket" }), "LLM")).toBe(false);
  });

  it("validates cron expressions in plain language", () => {
    expect(validateCronExpression("")).toMatch(/schedule/i);
    expect(validateCronExpression("0 9 * * 1-5")).toBeNull();
  });

  it("evaluates LLM readiness with model and prompt", () => {
    const edges: Edge[] = [{ id: "e1", source: "t", target: "l" }];
    const ctx = buildStepSetupContext(
      { id: "w", name: "W", description: "", category: "custom", version: "1", configFields: [], steps: [], sampleInput: {}, expectedOutput: {} },
      edges,
      [],
      kindLabel,
    );
    const llm = step({ id: "l", kind: "llm", name: "Classify", promptTemplate: "" });
    const { status, items } = evaluateStepReadiness(llm, ctx);
    expect(status).toBe("needs_setup");
    expect(items.find((i) => i.id === "prompt")?.passed).toBe(false);
    expect(items.find((i) => i.id === "model")?.passed).toBe(false);
  });

  it("marks LLM step ready when prompt and models exist", () => {
    const edges: Edge[] = [{ id: "e1", source: "t", target: "l" }];
    const template = {
      id: "w",
      name: "W",
      description: "",
      category: "custom" as const,
      version: "1",
      configFields: [],
      steps: [step({ id: "t", kind: "trigger", name: "Start" }), step({ id: "l", kind: "llm", name: "Classify", promptTemplate: "Go" })],
      sampleInput: {},
      expectedOutput: {},
    };
    const ctx = buildStepSetupContext(template, edges, [{ id: "c1", label: "Default", provider: "openai", model: "gpt-4" } as never], kindLabel);
    const llm = template.steps[1];
    const { status } = evaluateStepReadiness(llm, ctx);
    expect(status).toBe("ready");
  });

  it("suggests connecting a model when none configured", () => {
    const ctx = buildStepSetupContext(
      { id: "w", name: "W", description: "", category: "custom", version: "1", configFields: [], steps: [], sampleInput: {}, expectedOutput: {} },
      [],
      [],
      kindLabel,
    );
    const llm = step({ id: "l", kind: "llm", name: "Classify", promptTemplate: "Do work" });
    const next = getStepSuggestedNextSteps(llm, ctx);
    expect(next.some((n) => n.href === "/settings/llm-providers")).toBe(true);
  });

  it("suggests adding a trigger when workflow has none", () => {
    const template = {
      id: "w",
      name: "W",
      description: "",
      category: "custom" as const,
      version: "1",
      configFields: [],
      steps: [step({ id: "l", kind: "llm", name: "Only LLM" })],
      sampleInput: {},
      expectedOutput: {},
    };
    const next = getWorkflowSuggestedNextSteps(template, [], 1);
    expect(next[0]?.label).toMatch(/kicks this routine off/i);
    expect(next[0]?.stepKind).toBe("trigger");
  });

  it("returns humanized subtitle for approval steps", () => {
    const subtitle = getStepOutcomeSubtitle(step({ id: "a", kind: "approval", name: "Sign off" }));
    expect(subtitle).toMatch(/approves/i);
  });
});
