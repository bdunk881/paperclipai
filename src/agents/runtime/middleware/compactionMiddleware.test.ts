/**
 * Tests for compactionMiddleware (HEL-624): triggers on a char threshold,
 * rewrites ctx.messages at a safe assistant boundary, no-ops on SDK backends,
 * and is best-effort. The summariser is injected so no real model is called.
 */
import { describe, expect, it, jest } from "@jest/globals";

import {
  compactionMiddleware,
  estimateChars,
  DEFAULT_COMPACTION_THRESHOLD_CHARS,
} from "./compactionMiddleware";
import type { AgentRunContext } from "./types";
import type { NormalizedMessage } from "../../../llmConfig/adapters/types";

function transcript(): NormalizedMessage[] {
  return [
    { role: "user", content: "TASK" }, // 0
    { role: "assistant", content: "", toolCalls: [{ id: "1", name: "t", arguments: {} }] }, // 1
    { role: "tool", toolResults: [{ toolCallId: "1", content: "R1" }] }, // 2
    { role: "assistant", content: "", toolCalls: [{ id: "2", name: "t", arguments: {} }] }, // 3
    { role: "tool", toolResults: [{ toolCallId: "2", content: "R2" }] }, // 4
    { role: "assistant", content: "", toolCalls: [{ id: "3", name: "t", arguments: {} }] }, // 5
    { role: "tool", toolResults: [{ toolCallId: "3", content: "R3" }] }, // 6
  ];
}

function makeCtx(
  messages: NormalizedMessage[],
  backend: AgentRunContext["backend"] = "fallback",
): AgentRunContext {
  return {
    run: {} as AgentRunContext["run"],
    binding: { provider: "anthropic", model: "m", apiKey: "k" },
    messages,
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
    state: new Map(),
    backend,
  };
}

describe("estimateChars", () => {
  it("counts content, tool args, and tool results", () => {
    expect(estimateChars([{ role: "user", content: "hello" }])).toBe(5);
    expect(
      estimateChars([{ role: "tool", toolResults: [{ toolCallId: "x", content: "abcd" }] }]),
    ).toBe(4);
  });
});

describe("compactionMiddleware", () => {
  it("does nothing below the threshold", async () => {
    const summarize = jest.fn<(c: AgentRunContext, o: NormalizedMessage[]) => Promise<string>>();
    const ctx = makeCtx(transcript());
    const before = ctx.messages;
    const next = jest.fn(async () => ({}) as never);
    await compactionMiddleware({ thresholdChars: 1_000_000, summarize }).beforeModelCall!(ctx, next);
    expect(ctx.messages).toBe(before);
    expect(summarize).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("summarises older turns and keeps task + recent at a safe boundary", async () => {
    const summarize = jest
      .fn<(c: AgentRunContext, o: NormalizedMessage[]) => Promise<string>>()
      .mockResolvedValue("SUMMARY");
    const ctx = makeCtx(transcript());
    const next = jest.fn(async () => ({}) as never);
    await compactionMiddleware({
      thresholdChars: 1,
      keepRecentMessages: 2,
      summarize,
    }).beforeModelCall!(ctx, next);

    // older = msgs[1..5); recent = msgs[5..] (assistant, tool)
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(summarize.mock.calls[0]![1]).toHaveLength(4);
    expect(ctx.messages).toHaveLength(3);
    expect(ctx.messages[0].role).toBe("user");
    expect(ctx.messages[0].content).toContain("TASK");
    expect(ctx.messages[0].content).toContain("SUMMARY");
    // recent tail preserved verbatim, starting at an assistant message.
    expect(ctx.messages[1].role).toBe("assistant");
    expect(ctx.messages[2].role).toBe("tool");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("no-ops on SDK backends (compaction delegated)", async () => {
    const summarize = jest.fn<(c: AgentRunContext, o: NormalizedMessage[]) => Promise<string>>();
    const ctx = makeCtx(transcript(), "claude_sdk");
    const before = ctx.messages;
    const next = jest.fn(async () => ({}) as never);
    await compactionMiddleware({ thresholdChars: 1, summarize }).beforeModelCall!(ctx, next);
    expect(ctx.messages).toBe(before);
    expect(summarize).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("is best-effort: a summariser failure leaves history intact and proceeds", async () => {
    const summarize = jest
      .fn<(c: AgentRunContext, o: NormalizedMessage[]) => Promise<string>>()
      .mockRejectedValue(new Error("summary model down"));
    const ctx = makeCtx(transcript());
    const before = ctx.messages;
    const next = jest.fn(async () => ({}) as never);
    await compactionMiddleware({ thresholdChars: 1, keepRecentMessages: 2, summarize }).beforeModelCall!(
      ctx,
      next,
    );
    expect(ctx.messages).toBe(before); // unchanged
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("exposes a sane default threshold", () => {
    expect(DEFAULT_COMPACTION_THRESHOLD_CHARS).toBeGreaterThan(10_000);
  });
});
