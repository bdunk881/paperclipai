export type StandardErrorType =
  | "auth"
  | "rate-limit"
  | "schema"
  | "network"
  | "upstream";

export type StandardErrorCategory =
  | "auth-related"
  | "rate-limit-related"
  | "retryable"
  | "non-retryable";

const DEFAULT_RATE_LIMIT_PATTERN = /rate.?limit|too many/i;

export function classifyStandardErrorType(
  status: number,
  text: string,
  rateLimitPattern: RegExp = DEFAULT_RATE_LIMIT_PATTERN
): StandardErrorType {
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 429 || rateLimitPattern.test(text)) {
    return "rate-limit";
  }
  if (status >= 500) {
    return "upstream";
  }
  if (status >= 400) {
    return "schema";
  }
  return "network";
}

export function getStandardErrorCategory(type: StandardErrorType): StandardErrorCategory {
  if (type === "auth") {
    return "auth-related";
  }
  if (type === "rate-limit") {
    return "rate-limit-related";
  }
  if (type === "network" || type === "upstream") {
    return "retryable";
  }
  return "non-retryable";
}

export function isStandardRetryable(type: StandardErrorType): boolean {
  const category = getStandardErrorCategory(type);
  return category === "retryable" || category === "rate-limit-related";
}

export function exponentialBackoffMs(
  attempt: number,
  baseDelayMs = 250,
  jitterMs = 200
): number {
  return baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * jitterMs);
}

function parseRetryAfterHeader(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const asSeconds = Number(value);
  if (Number.isFinite(asSeconds)) {
    return Math.max(0, asSeconds) * 1000;
  }

  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) {
    return null;
  }

  return Math.max(0, retryAt - Date.now());
}

export function resolveRetryDelayMs(params: {
  attempt: number;
  headers?: Headers;
  baseDelayMs?: number;
  jitterMs?: number;
}): number {
  const retryAfterMs = parseRetryAfterHeader(params.headers?.get("Retry-After") ?? null);
  if (retryAfterMs !== null) {
    return retryAfterMs;
  }

  return exponentialBackoffMs(params.attempt, params.baseDelayMs, params.jitterMs);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
