/**
 * HEL-669: Switch / multi-route step — unit tests.
 *
 * Routes to the first matching rule's target (forward jump), falls back when
 * none match, and — critically — only ever jumps FORWARD (backward/self/unknown
 * targets are ignored), so a Switch can never create a cycle.
 */

import { resolveSwitchJump } from "./switchStep";
import type { WorkflowStep, WorkflowTemplate } from "../types/workflow";

function makeStep(
  id: string,
  kind: WorkflowStep["kind"],
  config: Record<string, unknown> = {},
): WorkflowStep {
  return { id, name: id, kind, description: "", inputKeys: [], outputKeys: [], config };
}

function makeTemplate(steps: WorkflowStep[]): WorkflowTemplate {
  return {
    id: "t",
    name: "t",
    description: "",
    category: "custom",
    version: "1",
    configFields: [],
    steps,
    sampleInput: {},
    expectedOutput: {},
  };
}

// switch(0), a(1), b(2), fallback(3)
function tpl(cfg: Record<string, unknown>): WorkflowTemplate {
  return makeTemplate([
    makeStep("sw", "switch", cfg),
    makeStep("a", "action"),
    makeStep("b", "action"),
    makeStep("fb", "action"),
  ]);
}

describe("resolveSwitchJump (HEL-669)", () => {
  it("routes to the first matching rule's target (forward jump)", () => {
    const t = tpl({
      routes: [
        { condition: "x == 1", targetStepId: "a" },
        { condition: "x == 2", targetStepId: "b" },
      ],
      fallbackStepId: "fb",
    });
    const d = resolveSwitchJump(t.steps[0]!, t, { x: 2 }, 0);
    expect(d.jumpToStepIndex).toBe(2);
    expect(d.output.switchMatchedRoute).toBe(1);
  });

  it("first match wins when multiple rules are true", () => {
    const t = tpl({
      routes: [
        { condition: "x > 0", targetStepId: "a" },
        { condition: "x > 0", targetStepId: "b" },
      ],
    });
    const d = resolveSwitchJump(t.steps[0]!, t, { x: 5 }, 0);
    expect(d.jumpToStepIndex).toBe(1);
    expect(d.output.switchMatchedRoute).toBe(0);
  });

  it("takes the fallback when no rule matches", () => {
    const t = tpl({ routes: [{ condition: "x == 9", targetStepId: "a" }], fallbackStepId: "fb" });
    const d = resolveSwitchJump(t.steps[0]!, t, { x: 1 }, 0);
    expect(d.jumpToStepIndex).toBe(3);
    expect(d.output.switchMatchedRoute).toBeNull();
  });

  it("does not jump when no rule matches and there is no fallback", () => {
    const t = tpl({ routes: [{ condition: "x == 9", targetStepId: "a" }] });
    const d = resolveSwitchJump(t.steps[0]!, t, { x: 1 }, 0);
    expect(d.jumpToStepIndex).toBeUndefined();
    expect(d.output.switchRouted).toBe(false);
  });

  it("ignores backward / self / unknown targets (forward-only safety)", () => {
    const back = makeTemplate([
      makeStep("body", "action"),
      makeStep("sw", "switch", { routes: [{ condition: "true == true", targetStepId: "body" }] }),
    ]);
    expect(resolveSwitchJump(back.steps[1]!, back, {}, 1).jumpToStepIndex).toBeUndefined();

    const unknown = tpl({ routes: [{ condition: "true == true", targetStepId: "ghost" }] });
    expect(resolveSwitchJump(unknown.steps[0]!, unknown, {}, 0).jumpToStepIndex).toBeUndefined();
  });
});
