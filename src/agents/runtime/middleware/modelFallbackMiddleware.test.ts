/**
 * Tests for modelFallbackMiddleware (HEL-627): switches ctx.binding.model to a
 * secondary model on a transient error, sticky (one failover per run), no-op on
 * non-transient errors or same-model fallback.
 */
import { describe, expect, it, jest } from "@jest/globals";

import { modelFallbackMiddleware } from "./modelFallbackMiddleware";
import { modelRetryMiddleware } from "./modelRetryMiddleware";
import { MiddlewarePipeline } from "./pipeline";
import type { AgentRunContext } from "./types";
import type { NormalizedResponse } from "../../../llmConfig/adapters/types";

function makeCtx(model: string): AgentRunContext {
  return {
    run: {} as AgentRunContext["run"],
    binding: { provider: "anthropic", model, apiKey: "k" },
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
    state: new Map(),
    backend: "fallback",
  };
}

const ok = (content: string): NormalizedResponse => ({
  content,
  toolCalls: [],
  usage: { inputTokens: 1, outputTokens: 1 },
  finishReason: "stop",
});

describe("modelFallbackMiddleware", () => {
  it("returns on success without switching the model", async () => {
    const ctx = makeCtx("primary");
    const next = jest.fn(async () => ok("hi"));
    const r = await modelFallbackMiddleware({ fallbackModel: "secondary" }).beforeModelCall!(
      ctx,
      next,
    );
    expect(r.content).toBe("hi");
    expect(ctx.binding.model).toBe("primary");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("fails over to the fallback model on a transient error and retries the call", async () => {
    const ctx = makeCtx("primary");
    let n = 0;
    const next = jest.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("529 overloaded");
      return ok("recovered");
    });
    const r = await modelFallbackMiddleware({ fallbackModel: "secondary" }).beforeModelCall!(
      ctx,
      next,
    );
    expect(r.content).toBe("recovered");
    expect(ctx.binding.model).toBe("secondary");
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("does not fail over on a non-transient error", async () => {
    const ctx = makeCtx("primary");
    const next = jest.fn(async () => {
      throw new Error("400 invalid request");
    });
    await expect(
      modelFallbackMiddleware({ fallbackModel: "secondary" }).beforeModelCall!(ctx, next),
    ).rejects.toThrow("invalid request");
    expect(ctx.binding.model).toBe("primary");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("only fails over once per run", async () => {
    const ctx = makeCtx("primary");
    const mw = modelFallbackMiddleware({ fallbackModel: "secondary" });
    const next = jest.fn(async () => {
      throw new Error("503 service unavailable");
    });
    // primary fails -> switch -> secondary also fails -> throw
    await expect(mw.beforeModelCall!(ctx, next)).rejects.toThrow("503");
    expect(ctx.binding.model).toBe("secondary");
    expect(next).toHaveBeenCalledTimes(2);
    // a later model call in the same run: already failed over -> single attempt
    next.mockClear();
    await expect(mw.beforeModelCall!(ctx, next)).rejects.toThrow("503");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("no-ops when the fallback model equals the current model", async () => {
    const ctx = makeCtx("same");
    const next = jest.fn(async () => {
      throw new Error("529 overloaded");
    });
    await expect(
      modelFallbackMiddleware({ fallbackModel: "same" }).beforeModelCall!(ctx, next),
    ).rejects.toThrow("529");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("composes with retry (fallback outside retry): exhaust primary, fail over, retry secondary", async () => {
    const ctx = makeCtx("primary");
    const pipeline = new MiddlewarePipeline([
      modelFallbackMiddleware({ fallbackModel: "secondary" }),
      modelRetryMiddleware({ maxAttempts: 2, sleep: async () => {}, random: () => 0 }),
    ]);
    const calls: string[] = [];
    const r = await pipeline.modelCall(ctx, async () => {
      calls.push(ctx.binding.model);
      if (ctx.binding.model === "primary") throw new Error("529 overloaded");
      return ok("done-on-secondary");
    });
    expect(r.content).toBe("done-on-secondary");
    // 2 retry attempts on the primary, then failover, then 1 success on secondary.
    expect(calls).toEqual(["primary", "primary", "secondary"]);
    expect(ctx.binding.model).toBe("secondary");
  });
});
