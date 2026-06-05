/**
 * modelRetryMiddleware (HEL-626) — retries a single model call on transient
 * provider errors with bounded exponential backoff + jitter.
 *
 * Today a 429 / 5xx / timeout from the provider throws straight out of the
 * fallback loop, and the only recovery is BullMQ re-running the ENTIRE turn
 * from scratch (losing accumulated history + usage). This `beforeModelCall`
 * middleware wraps the model call so a transient blip self-heals in-loop.
 *
 * Model-phase, so it's wired into the pipeline but only acts on the
 * FallbackAgentBackend (the only backend that drives `pipeline.modelCall`); on
 * the SDK backends `beforeModelCall` is never invoked, so retry is delegated to
 * the SDK's own logic. Safe-by-default (no flag); `maxAttempts <= 1` disables.
 *
 * Retries re-send the same request (the message history is unchanged between
 * attempts), so this is safe for the non-streaming path. Errors are classified
 * heuristically because the provider adapters wrap failures in a generic Error
 * — we look at an attached HTTP status when present, then fall back to message
 * signals.
 */
import type { AgentMiddleware, ModelCallResult } from "./types";

export interface ModelRetryOptions {
  /** Total attempts including the first. Default 3. <=1 disables retry. */
  maxAttempts?: number;
  /** Base backoff in ms (doubles per attempt). Default 500. */
  baseDelayMs?: number;
  /** Backoff ceiling in ms. Default 8000. */
  maxDelayMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter source for tests. Returns [0, 1). */
  random?: () => number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Heuristic: is this provider error worth retrying? */
export function isTransientModelError(err: unknown): boolean {
  const status =
    (err as { status?: number; statusCode?: number })?.status ??
    (err as { statusCode?: number })?.statusCode;
  if (typeof status === "number") {
    if (status === 408 || status === 429 || (status >= 500 && status <= 599)) return true;
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (/\b(408|425|429|500|502|503|504|529)\b/.test(msg)) return true;
  return (
    msg.includes("rate limit") ||
    msg.includes("overloaded") ||
    msg.includes("too many requests") ||
    msg.includes("service unavailable") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("socket hang up") ||
    msg.includes("network error")
  );
}

export function modelRetryMiddleware(options: ModelRetryOptions = {}): AgentMiddleware {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  return {
    name: "model-retry",
    async beforeModelCall(_ctx, next): Promise<ModelCallResult> {
      let lastErr: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await next();
        } catch (err) {
          lastErr = err;
          if (attempt >= maxAttempts || !isTransientModelError(err)) throw err;
          const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
          // Full jitter on the upper half so retries don't thunder together.
          await sleep(backoff + backoff * 0.5 * random());
        }
      }
      throw lastErr;
    },
  };
}
