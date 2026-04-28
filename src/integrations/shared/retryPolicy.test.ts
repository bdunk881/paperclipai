import {
  classifyStandardErrorType,
  exponentialBackoffMs,
  getStandardErrorCategory,
  isStandardRetryable,
  resolveRetryDelayMs,
} from "./retryPolicy";

describe("retryPolicy", () => {
  it("classifies standard connector failure types", () => {
    expect(classifyStandardErrorType(401, "invalid token")).toBe("auth");
    expect(classifyStandardErrorType(429, "too many requests")).toBe("rate-limit");
    expect(classifyStandardErrorType(503, "provider outage")).toBe("upstream");
    expect(classifyStandardErrorType(422, "bad payload")).toBe("schema");
  });

  it("maps error types into standard retry categories", () => {
    expect(getStandardErrorCategory("auth")).toBe("auth-related");
    expect(getStandardErrorCategory("rate-limit")).toBe("rate-limit-related");
    expect(getStandardErrorCategory("upstream")).toBe("retryable");
    expect(getStandardErrorCategory("schema")).toBe("non-retryable");
  });

  it("retries only rate-limit, network, and upstream failures", () => {
    expect(isStandardRetryable("rate-limit")).toBe(true);
    expect(isStandardRetryable("network")).toBe(true);
    expect(isStandardRetryable("upstream")).toBe(true);
    expect(isStandardRetryable("auth")).toBe(false);
    expect(isStandardRetryable("schema")).toBe(false);
  });

  it("honors Retry-After when present", () => {
    const headers = new Headers({ "Retry-After": "0" });
    expect(resolveRetryDelayMs({ attempt: 2, headers })).toBe(0);
  });

  it("falls back to deterministic exponential backoff when jitter is disabled", () => {
    expect(exponentialBackoffMs(3, 100, 0)).toBe(800);
    expect(resolveRetryDelayMs({ attempt: 2, baseDelayMs: 100, jitterMs: 0 })).toBe(400);
  });
});
