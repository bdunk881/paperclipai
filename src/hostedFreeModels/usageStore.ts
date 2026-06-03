/**
 * Per-workspace daily token usage tracking for the hosted free tier (PR B.2).
 *
 * Scope:
 * - Tracks tokens (prompt + completion) consumed per workspace per UTC day.
 * - Enforces a 50K token/day soft cap so one runaway workspace doesn't
 *   exhaust the shared GROQ_API_KEY / OPENCODE_ZEN_API_KEY budget.
 * - Resets at UTC midnight (day-key rollover, no separate cron needed).
 *
 * Durability (HEL-467 / B8): the counter is backed by Postgres (source of
 * truth) with a Redis read-cache via `dailyUsageCounter`, so the cap is
 * shared across instances and survives restarts. Previously this was a
 * process-local `Map`, which gave each Fly machine its own allowance and
 * reset the count on every deploy. The public API is therefore async.
 *
 * Engine hook (src/engine/stepHandlers.ts):
 *   - BEFORE each hosted-free call: `await assertWithinHostedFreeCap(workspaceId)`
 *     throws HostedFreeCapExceededError when the workspace has hit the cap.
 *   - AFTER the call: `await recordHostedFreeTokens(workspaceId, promptTokens +
 *     completionTokens)`.
 */

import {
  consumeDailyUsage,
  getDailyUsage,
  usageDayKey,
  __resetDailyUsageForTests,
} from "../billing/usage/dailyUsageCounter";

export const HOSTED_FREE_DAILY_TOKEN_CAP = 50_000;
export const HOSTED_FREE_SOFT_WARNING_THRESHOLD = 0.8;

const METRIC = "hosted_free_tokens" as const;

export interface HostedFreeUsageSnapshot {
  workspaceId: string;
  dayKey: string;
  usedTokens: number;
  capTokens: number;
  remainingTokens: number;
  /** True when usage / cap >= soft warning threshold (default 80%). */
  warning: boolean;
  /** True when usage >= cap. Engine MUST refuse new hosted-free calls. */
  exceeded: boolean;
}

function snapshotFor(workspaceId: string, used: number, now: Date): HostedFreeUsageSnapshot {
  return {
    workspaceId,
    dayKey: usageDayKey(now),
    usedTokens: used,
    capTokens: HOSTED_FREE_DAILY_TOKEN_CAP,
    remainingTokens: Math.max(0, HOSTED_FREE_DAILY_TOKEN_CAP - used),
    warning: used / HOSTED_FREE_DAILY_TOKEN_CAP >= HOSTED_FREE_SOFT_WARNING_THRESHOLD,
    exceeded: used >= HOSTED_FREE_DAILY_TOKEN_CAP,
  };
}

export async function getHostedFreeUsage(
  workspaceId: string,
  now: Date = new Date(),
): Promise<HostedFreeUsageSnapshot> {
  const used = await getDailyUsage(METRIC, workspaceId, now);
  return snapshotFor(workspaceId, used, now);
}

export class HostedFreeCapExceededError extends Error {
  readonly code = "hosted_free_daily_cap_exceeded";
  readonly snapshot: HostedFreeUsageSnapshot;

  constructor(snapshot: HostedFreeUsageSnapshot) {
    super(
      `Hosted free tier daily token cap reached (${snapshot.usedTokens}/${snapshot.capTokens} for ${snapshot.dayKey} UTC). ` +
        `Add a workspace LLM key in Settings → LLM Providers to keep running, or upgrade your plan.`,
    );
    this.name = "HostedFreeCapExceededError";
    this.snapshot = snapshot;
  }
}

/**
 * Throws when this workspace has hit the hosted-free daily cap. Called by the
 * engine fallback BEFORE invoking a hosted-free provider so the shared API key
 * budget can't get drained by a single workspace.
 */
export async function assertWithinHostedFreeCap(
  workspaceId: string,
  now: Date = new Date(),
): Promise<void> {
  const snapshot = await getHostedFreeUsage(workspaceId, now);
  if (snapshot.exceeded) {
    throw new HostedFreeCapExceededError(snapshot);
  }
}

/**
 * Increment this workspace's daily counter by `tokens` (prompt + completion)
 * and return the updated snapshot. Negative / non-finite inputs are clamped to
 * 0 by the counter so the total stays monotonically non-decreasing.
 */
export async function recordHostedFreeTokens(
  workspaceId: string,
  tokens: number,
  now: Date = new Date(),
): Promise<HostedFreeUsageSnapshot> {
  const total = await consumeDailyUsage(METRIC, workspaceId, tokens, now);
  return snapshotFor(workspaceId, total, now);
}

/** Test-only — clears the in-memory counter fallback. */
export function resetHostedFreeUsageForTests(): void {
  __resetDailyUsageForTests();
}
