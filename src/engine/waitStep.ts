/**
 * Wait step (HEL-672, Phase 1) — pure duration resolution.
 *
 * A `wait` step pauses a run for a duration or until a set time, then resumes
 * the rest of the workflow. The engine implements the pause durably (persist +
 * re-enqueue a delayed job that resumes via the replay-from-step path), so a
 * long wait releases the worker slot instead of blocking it. This module only
 * computes *how long* to wait — pure + unit-tested.
 *
 * Webhook-resume (resume on an external token) is a separate mechanism and is
 * deferred to a follow-up; this covers the timed modes (duration / until).
 */

import type { WorkflowStep } from "../types/workflow";

/** Hard cap on a single wait (30 days) — guards against absurd / typo delays. */
export const WAIT_MAX_MS = 30 * 24 * 60 * 60 * 1000;
/** No-queue (local/test) fallback cap for the in-process delay. */
export const WAIT_MAX_INLINE_MS = 15_000;

const UNIT_MS: Record<string, number> = {
  milliseconds: 1,
  seconds: 1000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

function resolveDurationMs(config: Record<string, unknown>): number {
  if (typeof config["durationMs"] === "number") return config["durationMs"];
  const rawAmount = config["amount"];
  const amount =
    typeof rawAmount === "number"
      ? rawAmount
      : typeof rawAmount === "string"
        ? Number(rawAmount)
        : NaN;
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const unit = typeof config["unit"] === "string" ? config["unit"] : "seconds";
  return amount * (UNIT_MS[unit] ?? UNIT_MS["seconds"]);
}

function resolveUntilMs(config: Record<string, unknown>, nowMs: number): number {
  const until = config["until"];
  const untilMs =
    typeof until === "number" ? until : typeof until === "string" ? Date.parse(until) : NaN;
  if (!Number.isFinite(untilMs)) return 0;
  return untilMs - nowMs;
}

/**
 * How long (ms) a `wait` step should pause, given the current time. `duration`
 * mode uses `durationMs` or `amount` + `unit`; `until` mode uses `until` (ISO
 * string or epoch ms) minus now. A past / invalid / missing target yields 0 (no
 * wait — the run continues). The result is floored at 0 and capped at
 * {@link WAIT_MAX_MS}.
 */
export function resolveWaitMs(step: WorkflowStep, nowMs: number): number {
  const config = (step.config ?? {}) as Record<string, unknown>;
  const mode = typeof config["mode"] === "string" ? config["mode"] : "duration";
  const ms = mode === "until" ? resolveUntilMs(config, nowMs) : resolveDurationMs(config);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(Math.floor(ms), WAIT_MAX_MS);
}
