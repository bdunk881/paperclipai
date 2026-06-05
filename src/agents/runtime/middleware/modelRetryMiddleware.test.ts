/**
 * Tests for modelRetryMiddleware (HEL-626): retries transient model errors
 * with bounded backoff, leaves non-transient errors alone, and gives up after
 * maxAttempts. sleep/random are injected so the test is deterministic + fast.
 */
import { describe, expect, it, jest } from "@jest/globals";

import { modelRetryMiddleware, isTransientModelError } from "./modelRetryMiddleware";
import type { AgentRunContext } from "./types";
import type { NormalizedResponse } from "../../../llmConfig/adapters/types";

const ctx = {} as AgentRunContext;
const ok = (content: string): NormalizedResponse => ({
  content,
  toolCalls: [],
  usage: { inputTokens: 1, outputTokens: 1 },
  finishReason: "stop",
});

describe("isTransientModelError", () => {
  it("flags 429 / 5xx / overloaded / timeouts as transient", () => {
    expect(isTransientModelError(new Error("429 Too Many Requests"))).toBe(true);
    expect(isTransientModelError(new Error("Anthropic adapter API error: 529 Overloaded"))).toBe(true);
    expect(isTransientModelError(new Error("503 service unavailable"))).toBe(true);
    expect(isTransientModelError(new Error("socket hang up"))).toBe(true);
    expect(isTransientModelError(Object.assign(new Error("nope"), { status: 502 }))).toBe(true);
  });

  it("does not flag client errors", () => {
    expect(isTransientModelError(new Error("400 invalid request"))).toBe(false);
    expect(isTransientModelError(new Error("401 unauthorized"))).toBe(false);
    expect(isTransientModelError(Object.assign(new Error("bad"), { status: 400 }))).toBe(false);
  });
});

describe("modelRetryMiddleware", () => {
  it("returns on first success without sleeping", async () => {
    const sleep = jest.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const next = jest.fn(async () => ok("hi"));
    const r = await modelRetryMiddleware({ sleep, random: () => 0 }).beforeModelCall!(ctx, next);
    expect(r.content).toBe("hi");
    expect(next).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a transient error then succeeds", async () => {
    const sleep = jest.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    let n = 0;
    const next = jest.fn(async () => {
      n += 1;
      if (n < 3) throw new Error("429 Too Many Requests");
      return ok("recovered");
    });
    const r = await modelRetryMiddleware({ maxAttempts: 3, sleep, random: () => 0 }).beforeModelCall!(
      ctx,
      next,
    );
    expect(r.content).toBe("recovered");
    expect(next).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-transient error", async () => {
    const sleep = jest.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const next = jest.fn(async () => {
      throw new Error("400 invalid request");
    });
    await expect(
      modelRetryMiddleware({ sleep }).beforeModelCall!(ctx, next),
    ).rejects.toThrow("invalid request");
    expect(next).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after maxAttempts and rethrows the last error", async () => {
    const sleep = jest.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const next = jest.fn(async () => {
      throw new Error("503 service unavailable");
    });
    await expect(
      modelRetryMiddleware({ maxAttempts: 2, sleep, random: () => 0 }).beforeModelCall!(ctx, next),
    ).rejects.toThrow("503");
    expect(next).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("disables retry when maxAttempts <= 1", async () => {
    const sleep = jest.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const next = jest.fn(async () => {
      throw new Error("429 rate limit");
    });
    await expect(
      modelRetryMiddleware({ maxAttempts: 1, sleep }).beforeModelCall!(ctx, next),
    ).rejects.toThrow("429");
    expect(next).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
