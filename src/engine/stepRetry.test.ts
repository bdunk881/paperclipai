/**
 * HEL-694: stepRetry — unit tests for the pure retry policy + backoff + runner.
 */
import { resolveRetryPolicy, backoffMs, withStepRetry } from "./stepRetry";
import type { RetryPolicy, WorkflowStep } from "../types/workflow";

function step(retry?: unknown): WorkflowStep {
  return {
    id: "s",
    name: "s",
    kind: "action",
    description: "",
    inputKeys: [],
    outputKeys: [],
    ...(retry !== undefined ? { retry: retry as RetryPolicy } : {}),
  };
}

const noWait = { sleep: async () => {} };

describe("resolveRetryPolicy", () => {
  it("returns a normalized policy when maxAttempts >= 2", () => {
    expect(resolveRetryPolicy(step({ type: "exponential", maxAttempts: 3, intervalMs: 500 }))).toEqual({
      type: "exponential",
      maxAttempts: 3,
      intervalMs: 500,
    });
  });

  it("treats an unknown type as constant", () => {
    expect(resolveRetryPolicy(step({ type: "weird", maxAttempts: 2 }))?.type).toBe("constant");
  });

  it("returns undefined for no / non-retrying policy", () => {
    expect(resolveRetryPolicy(step())).toBeUndefined();
    expect(resolveRetryPolicy(step({ type: "constant", maxAttempts: 1 }))).toBeUndefined();
    expect(resolveRetryPolicy(step("nope"))).toBeUndefined();
  });
});

describe("backoffMs", () => {
  it("constant returns the interval", () => {
    expect(backoffMs({ type: "constant", maxAttempts: 5, intervalMs: 250 }, 3)).toBe(250);
  });

  it("exponential grows by the factor and caps at maxInterval", () => {
    const p: RetryPolicy = { type: "exponential", maxAttempts: 9, intervalMs: 100, delayFactor: 2, maxInterval: 500 };
    expect(backoffMs(p, 1)).toBe(100); // 100 * 2^0
    expect(backoffMs(p, 2)).toBe(200); // 100 * 2^1
    expect(backoffMs(p, 3)).toBe(400); // 100 * 2^2
    expect(backoffMs(p, 4)).toBe(500); // 800 capped at 500
  });

  it("random uses the injected rng (full jitter)", () => {
    expect(backoffMs({ type: "random", maxAttempts: 3, intervalMs: 1000 }, 1, () => 0.25)).toBe(250);
  });
});

describe("withStepRetry", () => {
  it("calls fn once when there is no policy", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    await expect(withStepRetry(fn, undefined)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure then succeeds", async () => {
    let n = 0;
    const fn = jest.fn(async () => {
      n += 1;
      if (n < 3) throw new Error(`fail ${n}`);
      return "recovered";
    });
    const onRetry = jest.fn();
    await expect(
      withStepRetry(fn, { type: "constant", maxAttempts: 3, intervalMs: 5 }, { ...noWait, onRetry }),
    ).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("rethrows the last error once attempts are exhausted", async () => {
    const fn = jest.fn(async () => {
      throw new Error("always");
    });
    await expect(
      withStepRetry(fn, { type: "constant", maxAttempts: 3, intervalMs: 1 }, noWait),
    ).rejects.toThrow("always");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("stops early when the next backoff would exceed maxDuration", async () => {
    const fn = jest.fn(async () => {
      throw new Error("slow");
    });
    let t = 0;
    const now = () => (t += 0); // frozen clock; the delay alone trips the budget
    await expect(
      withStepRetry(
        fn,
        { type: "constant", maxAttempts: 10, intervalMs: 1000, maxDuration: 500 },
        { ...noWait, now },
      ),
    ).rejects.toThrow("slow");
    // first attempt runs, the 1000ms backoff exceeds the 500ms budget → no more
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
