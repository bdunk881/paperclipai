/**
 * Bounded Loop step (HEL-668, Phase 1).
 *
 * The engine (`_runSteps`) is a linear interpreter over `template.steps` with a
 * `jumpToStepIndex` escape hatch — already used for backward jumps (the approval
 * "request changes" path jumps to an earlier step). A Loop reuses that: when a
 * `loop` step is reached, it decides whether to jump **back** to the start of its
 * body (re-running those steps) or fall through (exit). Termination is guaranteed
 * by a hard iteration cap — there is no way to configure an unbounded loop.
 *
 * Config-driven (no graph cycle): the loop's body start is named by
 * `config.loopStartStepId` (an earlier step), so the canvas graph stays acyclic
 * and the existing validation is untouched. A visible loop-back edge is a
 * follow-up (editor UX). Config:
 *   - `loopStartStepId` (string)  — the earlier step to jump back to (the body start)
 *   - `maxIterations`   (number)  — body runs at most this many times (1 = no repeat)
 *   - `breakCondition`  (string?) — optional safe expression; truthy → exit early
 */

import { safeEvalCondition } from "./safeConditionEval";
import type { WorkflowStep, WorkflowTemplate } from "../types/workflow";

/** Absolute ceiling on loop iterations, independent of config — the ultimate
 *  termination guard against a hostile/buggy `maxIterations`. */
export const LOOP_HARD_CAP = 10_000;

/** Context key under which per-loop iteration counters live (keyed by step id). */
export const LOOP_COUNTER_KEY = "__loopIterations";

export interface LoopDecision {
  /** Step output (merged into context): iteration + whether it looped/broke. */
  output: Record<string, unknown>;
  /** When set, the engine jumps back here (the body start) to re-run the loop. */
  jumpToStepIndex?: number;
}

/**
 * Decide whether a `loop` step re-runs its body. Increments the loop's iteration
 * counter (in `context[LOOP_COUNTER_KEY]`) and returns a backward
 * `jumpToStepIndex` while iterations remain AND the break condition is false AND
 * the body start is a real earlier step; otherwise exits and resets the counter.
 */
export function resolveLoopJump(
  step: WorkflowStep,
  template: WorkflowTemplate,
  context: Record<string, unknown>,
  currentStepIndex: number,
): LoopDecision {
  const cfg = (step.config ?? {}) as Record<string, unknown>;
  const rawMax =
    typeof cfg["maxIterations"] === "number" && Number.isFinite(cfg["maxIterations"])
      ? Math.floor(cfg["maxIterations"] as number)
      : 1;
  const maxIterations = Math.min(Math.max(rawMax, 1), LOOP_HARD_CAP);
  const loopStartStepId =
    typeof cfg["loopStartStepId"] === "string" ? (cfg["loopStartStepId"] as string) : undefined;
  const breakCondition =
    typeof cfg["breakCondition"] === "string" ? (cfg["breakCondition"] as string) : undefined;

  const counters: Record<string, number> =
    context[LOOP_COUNTER_KEY] && typeof context[LOOP_COUNTER_KEY] === "object"
      ? (context[LOOP_COUNTER_KEY] as Record<string, number>)
      : {};
  const prior = typeof counters[step.id] === "number" ? counters[step.id] : 0;
  const iteration = prior + 1;

  let breakHit = false;
  if (breakCondition) {
    try {
      breakHit = safeEvalCondition(breakCondition, context);
    } catch {
      breakHit = false;
    }
  }

  // Resolve the body start; only BACKWARD jumps (an earlier index) are honored so
  // a misconfigured forward/self target can never run away.
  const targetIndex = loopStartStepId
    ? template.steps.findIndex((s) => s.id === loopStartStepId)
    : -1;

  const canLoop =
    !breakHit && iteration < maxIterations && targetIndex >= 0 && targetIndex < currentStepIndex;

  counters[step.id] = canLoop ? iteration : 0;
  context[LOOP_COUNTER_KEY] = counters;

  const output: Record<string, unknown> = {
    loopIteration: iteration,
    looping: canLoop,
    ...(breakHit ? { loopBroke: true } : {}),
  };
  return canLoop ? { output, jumpToStepIndex: targetIndex } : { output };
}
