/**
 * Per-workspace daily token usage tracking for the hosted free tier (PR B.2).
 *
 * Scope:
 * - Tracks tokens (prompt + completion) consumed per workspace per UTC day.
 * - Enforces a 50K token/day soft cap so one runaway workspace doesn't
 *   exhaust the shared GROQ_API_KEY / OPENCODE_ZEN_API_KEY budget.
 * - Resets at UTC midnight (day-key rollover, no separate cron needed).
 * - In-memory only — survives within a single API process. A workspace
 *   that genuinely hammers the cap loses its quota mid-day on every
 *   restart, but that's acceptable for B.2: the cap is a safety valve,
 *   not a billing source of truth. Postgres-backed durable usage lands
 *   if we ever need cross-process consistency.
 *
 * Engine hook (src/engine/stepHandlers.ts):
 *   - BEFORE each hosted-free call: assertWithinCap(workspaceId) throws
 *     HostedFreeCapExceededError when the workspace has hit the cap.
 *   - AFTER the call: recordTokensUsed(workspaceId, promptTokens +
 *     completionTokens).
 */

export const HOSTED_FREE_DAILY_TOKEN_CAP = 50_000;
export const HOSTED_FREE_SOFT_WARNING_THRESHOLD = 0.8;

interface UsageEntry {
  dayKey: string;
  tokens: number;
}

// allowlist: rolling counter / cached config; process-local by design
const usageByWorkspace = new Map<string, UsageEntry>();

function currentDayKey(now: Date = new Date()): string {
  // UTC YYYY-MM-DD so the cap rolls over consistently regardless of the
  // workspace owner's locale. Workspaces in PT see the cap reset at
  // 16:00 / 17:00 local — fine for the safety valve.
  return now.toISOString().slice(0, 10);
}

function entryFor(workspaceId: string, now: Date = new Date()): UsageEntry {
  const dayKey = currentDayKey(now);
  const existing = usageByWorkspace.get(workspaceId);
  if (existing && existing.dayKey === dayKey) {
    return existing;
  }
  const fresh: UsageEntry = { dayKey, tokens: 0 };
  usageByWorkspace.set(workspaceId, fresh);
  return fresh;
}

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

export function getHostedFreeUsage(
  workspaceId: string,
  now: Date = new Date(),
): HostedFreeUsageSnapshot {
  const entry = entryFor(workspaceId, now);
  const used = entry.tokens;
  return {
    workspaceId,
    dayKey: entry.dayKey,
    usedTokens: used,
    capTokens: HOSTED_FREE_DAILY_TOKEN_CAP,
    remainingTokens: Math.max(0, HOSTED_FREE_DAILY_TOKEN_CAP - used),
    warning: used / HOSTED_FREE_DAILY_TOKEN_CAP >= HOSTED_FREE_SOFT_WARNING_THRESHOLD,
    exceeded: used >= HOSTED_FREE_DAILY_TOKEN_CAP,
  };
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
 * Throws when this workspace has hit the hosted-free daily cap. Called
 * by the engine fallback BEFORE invoking a hosted-free provider so the
 * shared API key budget can't get drained by a single workspace.
 */
export function assertWithinHostedFreeCap(
  workspaceId: string,
  now: Date = new Date(),
): void {
  const snapshot = getHostedFreeUsage(workspaceId, now);
  if (snapshot.exceeded) {
    throw new HostedFreeCapExceededError(snapshot);
  }
}

/**
 * Increment this workspace's daily counter by `tokens` (prompt +
 * completion). Negative or non-finite inputs are clamped to 0 to keep
 * the counter monotonically non-decreasing across the day.
 */
export function recordHostedFreeTokens(
  workspaceId: string,
  tokens: number,
  now: Date = new Date(),
): HostedFreeUsageSnapshot {
  const entry = entryFor(workspaceId, now);
  const inc = Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : 0;
  entry.tokens += inc;
  return getHostedFreeUsage(workspaceId, now);
}

/** Test-only — clears the in-memory counter map. */
export function resetHostedFreeUsageForTests(): void {
  usageByWorkspace.clear();
}
