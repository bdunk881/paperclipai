/**
 * Tests for budgetMiddleware (HEL-622). The underlying spend SQL is covered by
 * budgetHook.test.ts; here we mock createBudgetHook and verify the middleware
 * translation (veto → isError short-circuit; approve → next()).
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockPreToolUse = jest.fn<(input: unknown) => Promise<unknown>>();
jest.mock("../budgetHook", () => ({
  createBudgetHook: () => ({ preToolUse: mockPreToolUse }),
}));

import { budgetMiddleware } from "./budgetMiddleware";
import type { AgentRunContext, ToolCall } from "./types";

const ctx = {} as AgentRunContext;
const call: ToolCall = { id: "c1", name: "do_thing", arguments: { a: 1 } };
const mw = budgetMiddleware({ pool: {} as never, workspaceId: "ws", agentId: "a" });

beforeEach(() => {
  mockPreToolUse.mockReset();
});

describe("budgetMiddleware", () => {
  it("short-circuits with the veto reason when the budget hook blocks", async () => {
    mockPreToolUse.mockResolvedValue({ continue: false, reason: "monthly budget exhausted" });
    const next = jest.fn(async () => ({ content: "ran" }));
    const out = await mw.beforeToolCall!(ctx, call, next);
    expect(out).toEqual({ content: "monthly budget exhausted", isError: true });
    expect(next).not.toHaveBeenCalled();
  });

  it("proceeds when the budget hook returns no decision (under cap)", async () => {
    mockPreToolUse.mockResolvedValue(undefined);
    const next = jest.fn(async () => ({ content: "ran" }));
    const out = await mw.beforeToolCall!(ctx, call, next);
    expect(out).toEqual({ content: "ran" });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("proceeds when the budget hook explicitly continues", async () => {
    mockPreToolUse.mockResolvedValue({ continue: true });
    const next = jest.fn(async () => ({ content: "ran" }));
    await mw.beforeToolCall!(ctx, call, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
