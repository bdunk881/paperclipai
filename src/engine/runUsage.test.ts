import { computeRunUsage, rollUpUsage } from "./runUsage";
import { WorkflowRun, StepResult } from "../types/workflow";

function step(overrides: Partial<StepResult> = {}): StepResult {
  return {
    stepId: "s",
    stepName: "Step",
    status: "success",
    output: {},
    durationMs: 0,
    ...overrides,
  };
}

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-1",
    templateId: "tpl",
    templateName: "T",
    status: "completed",
    startedAt: "2026-06-01T00:00:00.000Z",
    completedAt: "2026-06-01T00:00:05.000Z",
    input: {},
    stepResults: [],
    ...overrides,
  };
}

const costLog = (estimatedCostUsd: number, promptTokens: number, completionTokens: number) => ({
  modelTier: "standard" as const,
  modelId: "m",
  promptTokens,
  completionTokens,
  estimatedCostUsd,
});

describe("computeRunUsage (HEL-707)", () => {
  it("sums step cost (cents) + tokens and measures wall-clock duration", () => {
    const usage = computeRunUsage(
      run({
        stepResults: [
          step({ stepId: "a", costLog: costLog(0.012, 100, 50) }),
          step({ stepId: "b", costLog: costLog(0.008, 30, 20) }),
          step({ stepId: "c" }), // no costLog — contributes nothing
        ],
      }),
    );
    expect(usage.costInCents).toBe(2); // round(0.012*100)=1 + round(0.008*100)=1
    expect(usage.promptTokens).toBe(130);
    expect(usage.completionTokens).toBe(70);
    expect(usage.totalTokens).toBe(200);
    expect(usage.durationMs).toBe(5000);
    expect(usage.stepCount).toBe(3);
  });

  it("measures an in-flight run to asOf", () => {
    const asOf = Date.parse("2026-06-01T00:00:10.000Z");
    const usage = computeRunUsage(run({ status: "running", completedAt: undefined }), asOf);
    expect(usage.durationMs).toBe(10_000);
  });

  it("ignores non-finite cost and is zero for a costless run", () => {
    const usage = computeRunUsage(
      run({ stepResults: [step({ costLog: costLog(NaN, 0, 0) })] }),
    );
    expect(usage.costInCents).toBe(0);
    expect(usage.totalTokens).toBe(0);
  });
});

describe("rollUpUsage (HEL-707)", () => {
  it("totals cost/tokens/runs across runs and breaks spend down per tag", () => {
    const runs = [
      run({
        id: "r1",
        tags: ["customer:acme", "tier:gold"],
        stepResults: [step({ costLog: costLog(1.0, 1000, 500) })],
      }),
      run({
        id: "r2",
        tags: ["customer:acme"],
        stepResults: [step({ costLog: costLog(0.5, 200, 100) })],
      }),
      run({ id: "r3", tags: [], stepResults: [step({ costLog: costLog(0.25, 50, 50) })] }),
    ];
    const rollup = rollUpUsage(runs);

    expect(rollup.totalRuns).toBe(3);
    expect(rollup.totalCostInCents).toBe(175); // 100 + 50 + 25
    expect(rollup.totalTokens).toBe(1900);
    // acme spans r1+r2; gold only r1 — overlapping buckets.
    expect(rollup.byTag["customer:acme"]).toEqual({ runs: 2, costInCents: 150, totalTokens: 1800 });
    expect(rollup.byTag["tier:gold"]).toEqual({ runs: 1, costInCents: 100, totalTokens: 1500 });
    expect(rollup.byTag["customer:acme"].costInCents).toBeLessThan(rollup.totalCostInCents);
  });

  it("is empty for no runs", () => {
    expect(rollUpUsage([])).toEqual({
      totalRuns: 0,
      totalCostInCents: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      byTag: {},
    });
  });
});
