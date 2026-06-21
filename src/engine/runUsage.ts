/**
 * HEL-707: usage / cost aggregation.
 *
 * Pure roll-ups over the per-step `costLog` (model tokens + estimatedCostUsd)
 * and step/run timing that the engine already persists — a per-run usage
 * summary (cost in cents, tokens, duration) and a workspace roll-up with a
 * per-tag (HEL-704) breakdown, mirroring trigger.dev's run usage. No new
 * storage: this reads what runs/step_results already carry.
 */

import { WorkflowRun } from "../types/workflow";
import {
  resolveMachinePreset,
  machineCostCents,
  type MachinePresetId,
} from "./machinePresets";

export interface RunUsage {
  runId: string;
  /** Estimated LLM cost in whole cents (summed over the run's steps). */
  costInCents: number;
  /** HEL-806: machine/compute cost in whole cents — wall-time × the preset rate. */
  machineCostInCents: number;
  /** HEL-806: LLM + machine cost in whole cents. */
  totalCostInCents: number;
  /** HEL-806: the machine preset the run is billed at (config.machine, else default). */
  machine: MachinePresetId;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Wall-clock run duration; ongoing runs are measured to `asOf`. */
  durationMs: number;
  stepCount: number;
}

export interface UsageRollup {
  totalRuns: number;
  /** LLM cost only (unchanged meaning for back-compat). */
  totalCostInCents: number;
  /** HEL-806: machine/compute cost across the runs. */
  totalMachineCostInCents: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  /** Per-tag spend breakdown — a run contributes to each of its tags. */
  byTag: Record<
    string,
    { runs: number; costInCents: number; machineCostInCents: number; totalTokens: number }
  >;
}

function costCents(estimatedCostUsd: number | undefined): number {
  if (typeof estimatedCostUsd !== "number" || !Number.isFinite(estimatedCostUsd)) return 0;
  return Math.max(0, Math.round(estimatedCostUsd * 100));
}

/**
 * Per-run usage summary. Cost + tokens are summed from each step's `costLog`;
 * duration is wall-clock (`completedAt - startedAt`, or `asOf - startedAt`
 * while the run is still in flight). `asOf` is injected for testability —
 * callers pass `Date.now()`.
 */
export function computeRunUsage(run: WorkflowRun, asOf: number = Date.now()): RunUsage {
  let costInCents = 0;
  let promptTokens = 0;
  let completionTokens = 0;

  for (const step of run.stepResults ?? []) {
    const log = step.costLog;
    if (!log) continue;
    costInCents += costCents(log.estimatedCostUsd);
    promptTokens += Number.isFinite(log.promptTokens) ? log.promptTokens : 0;
    completionTokens += Number.isFinite(log.completionTokens) ? log.completionTokens : 0;
  }

  const startMs = Date.parse(run.startedAt);
  const endMs = run.completedAt ? Date.parse(run.completedAt) : asOf;
  const durationMs =
    Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;

  // HEL-806: machine cost = wall-time × the run's machine-preset rate.
  const preset = resolveMachinePreset(run.runtimeState?.config);
  const machineCostInCents = machineCostCents(preset, durationMs);

  return {
    runId: run.id,
    costInCents,
    machineCostInCents,
    totalCostInCents: costInCents + machineCostInCents,
    machine: preset.id,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    durationMs,
    stepCount: run.stepResults?.length ?? 0,
  };
}

/**
 * Roll up usage across a set of runs, with a per-tag breakdown. A run with
 * multiple tags contributes its full cost to each tag (overlapping buckets —
 * the per-tag totals are not mutually exclusive and may exceed the grand total).
 */
export function rollUpUsage(runs: WorkflowRun[], asOf: number = Date.now()): UsageRollup {
  const rollup: UsageRollup = {
    totalRuns: runs.length,
    totalCostInCents: 0,
    totalMachineCostInCents: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    byTag: {},
  };

  for (const run of runs) {
    const usage = computeRunUsage(run, asOf);
    rollup.totalCostInCents += usage.costInCents;
    rollup.totalMachineCostInCents += usage.machineCostInCents;
    rollup.totalPromptTokens += usage.promptTokens;
    rollup.totalCompletionTokens += usage.completionTokens;
    rollup.totalTokens += usage.totalTokens;

    for (const tag of run.tags ?? []) {
      const bucket =
        rollup.byTag[tag] ?? { runs: 0, costInCents: 0, machineCostInCents: 0, totalTokens: 0 };
      bucket.runs += 1;
      bucket.costInCents += usage.costInCents;
      bucket.machineCostInCents += usage.machineCostInCents;
      bucket.totalTokens += usage.totalTokens;
      rollup.byTag[tag] = bucket;
    }
  }

  return rollup;
}
