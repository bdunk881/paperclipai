import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Pool, QueryResult } from "pg";

// Mock the approvalStore before importing the bridge.
const mockCreate = jest.fn<
  (params: Record<string, unknown>) => Promise<{ id: string }>
>(async () => ({ id: "approval-1" }));
const mockGet = jest.fn<(id: string) => Promise<Record<string, unknown> | undefined>>();

jest.mock("../../engine/approvalStore", () => ({
  approvalStore: {
    create: mockCreate,
    get: mockGet,
  },
}));

import {
  encodePlanApprovalMessage,
  filePlanApprovalRequest,
  parsePlanApprovalMessage,
  PLAN_APPROVAL_TEMPLATE_NAME,
  resumeApprovedPlan,
} from "./planApprovalBridge";

const WS_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";
const USER_ID = "user-1";

beforeEach(() => {
  mockCreate.mockClear();
  mockGet.mockReset();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("encodePlanApprovalMessage / parsePlanApprovalMessage", () => {
  it("round-trips the plan text and the original prompt", () => {
    const encoded = encodePlanApprovalMessage({
      planText: "1. Pull leads\n2. Email them",
      originalPrompt: "Email the top 5 leads.",
    });
    const parsed = parsePlanApprovalMessage(encoded);
    expect(parsed.planText).toBe("1. Pull leads\n2. Email them");
    expect(parsed.originalPrompt).toBe("Email the top 5 leads.");
  });

  it("returns the whole message as plan text when the delimiter is missing", () => {
    const parsed = parsePlanApprovalMessage("just a plan");
    expect(parsed.planText).toBe("just a plan");
    expect(parsed.originalPrompt).toBe("");
  });
});

describe("filePlanApprovalRequest", () => {
  it("creates an approval row with the plan template name and our agent context", async () => {
    const result = await filePlanApprovalRequest({
      workspaceId: WS_ID,
      userId: USER_ID,
      agentId: AGENT_ID,
      agentName: "Alice",
      runId: RUN_ID,
      originalPrompt: "Email the top 5 leads.",
      planText: "1. Pull leads\n2. Email them",
    });
    expect(result.approvalId).toBe("approval-1");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0]![0];
    expect(call.templateName).toBe(PLAN_APPROVAL_TEMPLATE_NAME);
    expect(call.runId).toBe(RUN_ID);
    expect(call.assignee).toBe(USER_ID);
    expect(call.agentId).toBe(AGENT_ID);
    expect(call.userId).toBe(USER_ID);
    expect(String(call.message)).toContain("1. Pull leads");
    expect(String(call.message)).toContain("Email the top 5 leads.");
  });
});

describe("resumeApprovedPlan", () => {
  function fakePool(agentRow?: Record<string, unknown>): Pool {
    return {
      query: jest.fn(() =>
        Promise.resolve(
          ({ rows: agentRow ? [agentRow] : [] } as unknown as QueryResult),
        ),
      ),
    } as unknown as Pool;
  }

  it("refuses when the approval doesn't exist", async () => {
    mockGet.mockResolvedValueOnce(undefined);
    const result = await resumeApprovedPlan({
      pool: fakePool(),
      approvalId: "missing",
    });
    expect(result).toEqual({ resumed: false, reason: "approval_not_found" });
  });

  it("refuses when the approval is not yet approved", async () => {
    mockGet.mockResolvedValueOnce({ status: "pending" });
    const result = await resumeApprovedPlan({
      pool: fakePool(),
      approvalId: "approval-1",
    });
    expect(result.resumed).toBe(false);
    expect(result.reason).toMatch(/pending/);
  });

  it("refuses when the approval is missing agentId / userId", async () => {
    mockGet.mockResolvedValueOnce({ status: "approved", message: "plan" });
    const result = await resumeApprovedPlan({
      pool: fakePool(),
      approvalId: "approval-1",
    });
    expect(result.resumed).toBe(false);
    expect(result.reason).toMatch(/agent_id/);
  });

  it("refuses when the agent row is gone", async () => {
    mockGet.mockResolvedValueOnce({
      status: "approved",
      message: "plan",
      agentId: AGENT_ID,
      userId: USER_ID,
    });
    const result = await resumeApprovedPlan({
      pool: fakePool(),
      approvalId: "approval-1",
    });
    expect(result.resumed).toBe(false);
    expect(result.reason).toBe("agent_not_found");
  });

  it("re-runs the agent with the approved plan folded into the system prompt", async () => {
    mockGet.mockResolvedValueOnce({
      status: "approved",
      message: encodePlanApprovalMessage({
        planText: "1. Email Alice",
        originalPrompt: "Reach out to leads",
      }),
      agentId: AGENT_ID,
      userId: USER_ID,
    });
    const fakeRunAgentTurn = jest.fn<
      (input: Record<string, unknown>) => Promise<{
        text: string;
        usage: { promptTokens: number; completionTokens: number };
        provider: string;
        model: string;
      }>
    >(async () => ({
      text: "done",
      usage: { promptTokens: 1, completionTokens: 1 },
      provider: "anthropic",
      model: "claude-sonnet",
    }));
    const result = await resumeApprovedPlan({
      pool: fakePool({
        workspace_id: WS_ID,
        name: "Alice",
        role_key: "sdr",
        instructions: "Be terse.",
      }),
      approvalId: "approval-1",
      runAgentTurnFn:
        fakeRunAgentTurn as unknown as typeof import("../runAgentTurn").runAgentTurn,
    });
    expect(result.resumed).toBe(true);
    expect(fakeRunAgentTurn).toHaveBeenCalledTimes(1);
    const call = fakeRunAgentTurn.mock.calls[0]![0];
    expect(call.permissionMode).toBe("auto");
    expect(String(call.systemPrompt)).toContain("# APPROVED PLAN");
    expect(String(call.systemPrompt)).toContain("1. Email Alice");
    expect(call.userPrompt).toBe("Reach out to leads");
  });

  it("returns a reason when the recursive runAgentTurn throws", async () => {
    mockGet.mockResolvedValueOnce({
      status: "approved",
      message: "plan",
      agentId: AGENT_ID,
      userId: USER_ID,
    });
    const fakeRunAgentTurn = jest.fn<
      (input: Record<string, unknown>) => Promise<never>
    >(() => Promise.reject(new Error("model timed out")));
    const result = await resumeApprovedPlan({
      pool: fakePool({
        workspace_id: WS_ID,
        name: "Alice",
        role_key: "sdr",
        instructions: null,
      }),
      approvalId: "approval-1",
      runAgentTurnFn:
        fakeRunAgentTurn as unknown as typeof import("../runAgentTurn").runAgentTurn,
    });
    expect(result.resumed).toBe(false);
    expect(result.reason).toMatch(/model timed out/);
  });
});
