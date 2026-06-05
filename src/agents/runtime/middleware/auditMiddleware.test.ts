/**
 * Tests for auditMiddleware (HEL-622): records a per-tool-call audit row via
 * auditService on success and error, never logs tool args, and is best-effort.
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockRecordAction = jest.fn<(...args: unknown[]) => Promise<void>>();
jest.mock("../../../auditing/auditService", () => ({
  auditService: { recordAction: (...args: unknown[]) => mockRecordAction(...args) },
}));

import { auditMiddleware } from "./auditMiddleware";
import type { AgentRunContext, ToolCall } from "./types";

function makeCtx(): AgentRunContext {
  return {
    run: {
      pool: { POOL: true } as never,
      workspaceId: "ws-1",
      userId: "user-1",
      agentId: "agent-1",
      agentName: "Agent Smith",
      runId: "run-1",
      systemPrompt: "s",
      userPrompt: "u",
    } as unknown as AgentRunContext["run"],
    binding: { provider: "anthropic", model: "m", apiKey: "k" },
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
    state: new Map(),
    backend: "fallback",
  };
}

const call: ToolCall = { id: "c1", name: "save_memory", arguments: { secret: "do-not-log" } };
const mw = auditMiddleware();

type Entry = {
  category: string;
  action: string;
  target: { type: string; id: string };
  metadata: { ok: boolean; runId: string | null; agentName: string; error?: string };
};

beforeEach(() => {
  mockRecordAction.mockReset().mockResolvedValue(undefined);
});

describe("auditMiddleware", () => {
  it("records a successful tool call to the audit log", async () => {
    const out = await mw.afterToolCall!(makeCtx(), call, { content: "ok" });
    expect(out).toEqual({ content: "ok" });
    expect(mockRecordAction).toHaveBeenCalledTimes(1);
    const [ctxArg, entry, pool] = mockRecordAction.mock.calls[0]! as [unknown, Entry, unknown];
    expect(ctxArg).toEqual({ workspaceId: "ws-1", userId: "user-1", actorAgentId: "agent-1" });
    expect(entry).toMatchObject({
      category: "execution",
      action: "agent_tool_call",
      target: { type: "tool", id: "save_memory" },
      metadata: { ok: true, runId: "run-1", agentName: "Agent Smith" },
    });
    expect(pool).toBeDefined();
  });

  it("records an error outcome with ok:false + an error snippet, and never logs tool args", async () => {
    await mw.afterToolCall!(makeCtx(), call, {
      content: 'Tool "save_memory" failed: boom',
      isError: true,
    });
    const [, entry] = mockRecordAction.mock.calls[0]! as [unknown, Entry, unknown];
    expect(entry.metadata.ok).toBe(false);
    expect(entry.metadata.error).toContain("boom");
    // Tool arguments must never reach the audit row.
    expect(JSON.stringify(entry)).not.toContain("do-not-log");
  });

  it("is best-effort: a recordAction failure is swallowed and the outcome passes through", async () => {
    mockRecordAction.mockRejectedValue(new Error("db down"));
    const out = await mw.afterToolCall!(makeCtx(), call, { content: "ok" });
    expect(out).toEqual({ content: "ok" });
  });
});
