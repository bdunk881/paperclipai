/**
 * Idempotent replay policy (HEL-696) — pure.
 *
 * When a run is replayed from the start (a BullMQ retry, or the HEL-695 reaper
 * re-enqueuing a stranded run), `_runSteps` re-executes from step 0. Without a
 * skip, every already-completed step re-fires its side effects. This module
 * decides which steps to REUSE (return the recorded output instead of
 * re-executing) vs RE-RUN.
 *
 * Keyed by execution ORDINAL (not stepIndex): a `loop` re-executes the same step
 * index many times, so ordinal keys are what stay unique (and satisfy the
 * partial-unique index on step_results.idempotency_key, migration 040).
 */
import type { StepKind, StepResult } from "../types/workflow";

/**
 * Step kinds whose recorded output is REUSED on replay instead of re-executing.
 * These are the kinds where re-running is harmful or divergent:
 *   - side-effecting: action, mcp, agent (external writes), data_table (an
 *     insert appends a NEW row each time — replaying it would double-insert)
 *   - pausing: wait, approval (would re-pause the run)
 *   - child-spawning: sub_workflow (would re-run the child + its side effects)
 *   - expensive / nondeterministic: llm, knowledge (cost + would diverge the
 *     replay, breaking ordinal alignment for later steps)
 *
 * Pure + control-flow kinds (trigger*, transform, condition, filter, merge,
 * output, stop_error, loop, switch) are deliberately NOT here — they re-run
 * deterministically. `loop`/`switch` MUST re-run to reproduce `jumpToStepIndex`;
 * because every nondeterministic output above is reused, the rebuilt context (and
 * therefore the control flow + step ordinals) reproduce identically.
 */
const REPLAY_REUSE_KINDS: ReadonlySet<StepKind> = new Set<StepKind>([
  "action",
  "mcp",
  "agent",
  "data_table",
  "llm",
  "knowledge",
  "sub_workflow",
  "wait",
  "approval",
]);

/** True when a step kind's recorded output should be reused on replay. */
export function shouldReuseStepKind(kind: StepKind): boolean {
  return REPLAY_REUSE_KINDS.has(kind);
}

/**
 * Build the prior-result lookup for an idempotent replay: idempotency key →
 * SUCCESSFUL prior result. Only success rows are reusable (a failed / incomplete
 * step must re-run). Must be built from the run's loaded `step_results` BEFORE
 * any new write — `writeStepResults` DELETEs + reinserts, so the prior rows are
 * gone after the first incremental persist of the replay.
 */
export function buildPriorResultMap(
  stepResults: StepResult[] | undefined,
): Map<string, StepResult> {
  const map = new Map<string, StepResult>();
  for (const sr of stepResults ?? []) {
    if (sr.idempotencyKey && sr.status === "success") {
      map.set(sr.idempotencyKey, sr);
    }
  }
  return map;
}
