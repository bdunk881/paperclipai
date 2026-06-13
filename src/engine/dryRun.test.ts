import { isDryRun, dryRunSkips, dryRunOutput, DRY_RUN_KEY } from "./dryRun";
import type { WorkflowStep } from "../types/workflow";

function step(kind: WorkflowStep["kind"], outputKeys: string[] = []): WorkflowStep {
  return { id: "s", name: "s", kind, description: "", inputKeys: [], outputKeys };
}

describe("dryRun", () => {
  it("isDryRun reads the flag, defaulting false", () => {
    expect(isDryRun({ [DRY_RUN_KEY]: true })).toBe(true);
    expect(isDryRun({ [DRY_RUN_KEY]: false })).toBe(false);
    expect(isDryRun({ [DRY_RUN_KEY]: "true" })).toBe(false); // strict === true
    expect(isDryRun({})).toBe(false);
    expect(isDryRun(undefined)).toBe(false);
    expect(isDryRun(null)).toBe(false);
  });

  it("dryRunSkips covers only the side-effecting executor kinds", () => {
    expect(dryRunSkips("action")).toBe(true);
    expect(dryRunSkips("mcp")).toBe(true);
    expect(dryRunSkips("agent")).toBe(true);
    // not skipped: llm runs (it's what eval measures), pure + control-flow kinds
    expect(dryRunSkips("llm")).toBe(false);
    expect(dryRunSkips("transform")).toBe(false);
    expect(dryRunSkips("output")).toBe(false);
    expect(dryRunSkips("condition")).toBe(false);
    expect(dryRunSkips("sub_workflow")).toBe(false); // handled by propagation, not skip
  });

  it("dryRunOutput marks the skip and seeds declared outputKeys to null", () => {
    const out = dryRunOutput(step("action", ["result", "ticketId"]));
    expect(out[DRY_RUN_KEY]).toBe(true);
    expect(out.skipped).toBe(true);
    expect(out.skippedKind).toBe("action");
    expect(out.result).toBeNull();
    expect(out.ticketId).toBeNull();
  });

  it("dryRunOutput handles a step with no declared outputKeys", () => {
    const out = dryRunOutput(step("mcp"));
    expect(out[DRY_RUN_KEY]).toBe(true);
    expect(Object.keys(out)).toEqual(["__dryRun", "skipped", "skippedKind"]);
  });
});
