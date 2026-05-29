import { callWorker, type CfWorkerErrorReason, type CfWorkerFailureMode } from "./client";

export interface RateLimitOptions {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
  timeoutMs?: number;
  onFailure?: CfWorkerFailureMode;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  source: "durable-object" | "fallback";
  errorReason?: CfWorkerErrorReason | "fail_closed";
}

interface RateLimitWorkerResponse {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface RateLimitRefundResponse {
  refunded: boolean;
}

function buildBody(options: RateLimitOptions): string {
  return JSON.stringify({
    scope: options.scope,
    key: options.key,
    limit: options.limit,
    windowMs: options.windowMs,
  });
}

export async function rateLimit(options: RateLimitOptions): Promise<RateLimitDecision> {
  try {
    const result = await callWorker<RateLimitWorkerResponse>(
      "/rate-limit/consume",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: buildBody(options),
      },
      {
        timeoutMs: options.timeoutMs,
        onFailure: options.onFailure ?? "fail-open",
        metadata: {
          feature: "rate_limiter",
          scope: options.scope,
          limit: options.limit,
          windowMs: options.windowMs,
        },
      },
    );

    if (!result.ok) {
      return {
        allowed: true,
        remaining: options.limit,
        retryAfterMs: 0,
        source: "fallback",
        errorReason: result.errorReason,
      };
    }

    return {
      allowed: result.data.allowed,
      remaining: result.data.remaining,
      retryAfterMs: result.data.retryAfterMs,
      source: "durable-object",
    };
  } catch {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: options.windowMs,
      source: "fallback",
      errorReason: "fail_closed",
    };
  }
}

export async function refundRateLimit(options: RateLimitOptions): Promise<boolean> {
  const result = await callWorker<RateLimitRefundResponse>(
    "/rate-limit/refund",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: buildBody(options),
    },
    {
      timeoutMs: options.timeoutMs,
      onFailure: "fail-open",
      metadata: {
        feature: "rate_limiter",
        scope: options.scope,
        operation: "refund",
      },
    },
  );

  return result.ok ? result.data.refunded : false;
}
