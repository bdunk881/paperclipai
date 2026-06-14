/**
 * Per-step retry + backoff (HEL-694) — pure.
 *
 * `retryPolicySchema` (portableSchema) is defined but `_runSteps` never consumed
 * it. This module reads a step's `retry` policy and wraps its throwing executor
 * (llm / knowledge / action / mcp / agent) so a transient failure retries with
 * backoff before the step (and run) fails. `withStepRetry(fn, undefined)` is a
 * pass-through, so steps with no policy are unchanged.
 */
import type { RetryPolicy, WorkflowStep } from "../types/workflow";

const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_FACTOR = 2;

/** Read + normalize a step's retry policy. Returns undefined when there is no
 *  usable policy (so the caller treats the step as non-retrying). */
export function resolveRetryPolicy(step: WorkflowStep): RetryPolicy | undefined {
  const raw = step.retry as unknown;
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Record<string, unknown>;
  const maxAttempts = typeof p.maxAttempts === "number" ? Math.floor(p.maxAttempts) : 0;
  if (maxAttempts < 2) return undefined; // 1 (or less) = no retry
  const type =
    p.type === "exponential" || p.type === "random" ? p.type : "constant";
  return {
    type,
    maxAttempts,
    ...(typeof p.intervalMs === "number" ? { intervalMs: p.intervalMs } : {}),
    ...(typeof p.delayFactor === "number" ? { delayFactor: p.delayFactor } : {}),
    ...(typeof p.maxInterval === "number" ? { maxInterval: p.maxInterval } : {}),
    ...(typeof p.maxDuration === "number" ? { maxDuration: p.maxDuration } : {}),
  };
}

/** Delay before retry `attempt` (1-based: the delay AFTER attempt N). Pure;
 *  `rng` is injectable so the random curve is deterministic in tests. */
export function backoffMs(policy: RetryPolicy, attempt: number, rng: () => number = Math.random): number {
  const base = policy.intervalMs ?? DEFAULT_INTERVAL_MS;
  let delay: number;
  if (policy.type === "exponential") {
    delay = base * Math.pow(policy.delayFactor ?? DEFAULT_FACTOR, Math.max(0, attempt - 1));
  } else if (policy.type === "random") {
    delay = base * rng(); // full jitter in [0, base)
  } else {
    delay = base; // constant
  }
  if (policy.maxInterval !== undefined) delay = Math.min(delay, policy.maxInterval);
  return Math.max(0, Math.round(delay));
}

export interface RetryHooks {
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
  now?: () => number;
  /** Called before each backoff wait — for logging / run-trace surfacing. */
  onRetry?: (info: { attempt: number; error: unknown; delayMs: number }) => void;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying on throw per `policy` (constant / exponential / random
 * backoff, capped by `maxInterval` and the `maxDuration` budget). Re-throws the
 * last error once attempts are exhausted. No policy → calls `fn` once.
 */
export async function withStepRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy | undefined,
  hooks: RetryHooks = {},
): Promise<T> {
  if (!policy || policy.maxAttempts <= 1) {
    return fn();
  }
  const sleep = hooks.sleep ?? realSleep;
  const rng = hooks.rng ?? Math.random;
  const now = hooks.now ?? Date.now;
  const start = now();

  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= policy.maxAttempts) break;
      const delayMs = backoffMs(policy, attempt, rng);
      if (policy.maxDuration !== undefined && now() - start + delayMs > policy.maxDuration) {
        break; // next wait would blow the retry budget — give up now
      }
      hooks.onRetry?.({ attempt, error, delayMs });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
