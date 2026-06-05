/**
 * Tests for promptCachingMiddleware (HEL-628): flips ctx.cacheControl on the
 * fallback backend, no-ops on the SDK backends (caching delegated).
 */
import { describe, expect, it, jest } from "@jest/globals";

import { promptCachingMiddleware } from "./promptCachingMiddleware";
import type { AgentRunContext } from "./types";

function makeCtx(backend: AgentRunContext["backend"]): AgentRunContext {
  return {
    run: {} as AgentRunContext["run"],
    binding: { provider: "anthropic", model: "m", apiKey: "k" },
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
    state: new Map(),
    backend,
  };
}

describe("promptCachingMiddleware", () => {
  it("enables cacheControl on the fallback backend", async () => {
    const ctx = makeCtx("fallback");
    const next = jest.fn(async () => ({}) as never);
    await promptCachingMiddleware().beforeModelCall!(ctx, next);
    expect(ctx.cacheControl).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("no-ops on the SDK backends (caching delegated)", async () => {
    for (const backend of ["claude_sdk", "openai_agents"] as const) {
      const ctx = makeCtx(backend);
      await promptCachingMiddleware().beforeModelCall!(
        ctx,
        jest.fn(async () => ({}) as never),
      );
      expect(ctx.cacheControl).toBeUndefined();
    }
  });
});
