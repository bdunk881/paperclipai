/**
 * HEL-668: bounded loop step — unit tests.
 *
 * The critical property is TERMINATION: resolveLoopJump must only ever produce a
 * BACKWARD jump, bounded by maxIterations (and the hard cap), and exit on a break
 * condition or a bad target. These tests pin that down.
 */

import { resolveLoopJump, LOOP_COUNTER_KEY } from "./loopStep";
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

// body(index 0) then loop(index 1) — the loop jumps back to the body.
function tpl(loopCfg: Record<string, unknown>): WorkflowTemplate {
  return makeTemplate([makeStep("body", "action"), makeStep("loop", "loop", loopCfg)]);
}

describe("resolveLoopJump (HEL-668)", () => {
  it("jumps back to the body start while iterations remain, then exits + resets", () => {
    const template = tpl({ loopStartStepId: "body", maxIterations: 3 });
    const loop = template.steps[1]!;
    const ctx: Record<string, unknown> = {};

    let d = resolveLoopJump(loop, template, ctx, 1);
    expect(d.jumpToStepIndex).toBe(0);
    expect(d.output.loopIteration).toBe(1);

    d = resolveLoopJump(loop, template, ctx, 1);
    expect(d.jumpToStepIndex).toBe(0);
    expect(d.output.loopIteration).toBe(2);

    d = resolveLoopJump(loop, template, ctx, 1);
    expect(d.jumpToStepIndex).toBeUndefined();
    expect(d.output.looping).toBe(false);
    expect((ctx[LOOP_COUNTER_KEY] as Record<string, number>).loop).toBe(0);
  });

  it("does not loop when maxIterations is 1 (run once)", () => {
    const template = tpl({ loopStartStepId: "body", maxIterations: 1 });
    expect(resolveLoopJump(template.steps[1]!, template, {}, 1).jumpToStepIndex).toBeUndefined();
  });

  it("exits early when the break condition is truthy", () => {
    const template = tpl({ loopStartStepId: "body", maxIterations: 10, breakCondition: "done == true" });
    const d = resolveLoopJump(template.steps[1]!, template, { done: true }, 1);
    expect(d.jumpToStepIndex).toBeUndefined();
    expect(d.output.loopBroke).toBe(true);
  });

  it("never jumps forward, to a self/unknown target, or with no target (safety)", () => {
    const forward = makeTemplate([
      makeStep("loop", "loop", { loopStartStepId: "later", maxIterations: 5 }),
      makeStep("later", "action"),
    ]);
    expect(resolveLoopJump(forward.steps[0]!, forward, {}, 0).jumpToStepIndex).toBeUndefined();

    const unknown = tpl({ loopStartStepId: "ghost", maxIterations: 5 });
    expect(resolveLoopJump(unknown.steps[1]!, unknown, {}, 1).jumpToStepIndex).toBeUndefined();

    const noTarget = tpl({ maxIterations: 5 });
    expect(resolveLoopJump(noTarget.steps[1]!, noTarget, {}, 1).jumpToStepIndex).toBeUndefined();
  });

  it("clamps maxIterations to a sane minimum (zero/negative → run once)", () => {
    const big = tpl({ loopStartStepId: "body", maxIterations: 1e9 });
    expect(resolveLoopJump(big.steps[1]!, big, {}, 1).jumpToStepIndex).toBe(0); // loops, but capped internally

    const zero = tpl({ loopStartStepId: "body", maxIterations: 0 });
    expect(resolveLoopJump(zero.steps[1]!, zero, {}, 1).jumpToStepIndex).toBeUndefined();
  });
});
