import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import type { Pool, QueryResult } from "pg";

// Mock runAgentTurn before importing the factory — the handler does a
// dynamic import of it, which Jest's module cache intercepts when we
// declare the mock at module load.
const mockRunAgentTurn = jest.fn<
  (input: Record<string, unknown>) => Promise<{
    text: string;
    usage: { promptTokens: number; completionTokens: number };
    provider: string;
    model: string;
  }>
>(async () => ({
  text: "Done by report.",
  usage: { promptTokens: 10, completionTokens: 5 },
  provider: "anthropic",
  model: "claude-sonnet-4-6",
}));
jest.mock("../runAgentTurn", () => ({
  runAgentTurn: (input: Record<string, unknown>) => mockRunAgentTurn(input),
}));

import {
  createDelegateToSubagentTool,
  MAX_DELEGATION_DEPTH,
} from "./delegateToSubagentTool";

const WS_ID = "11111111-1111-1111-1111-111111111111";
const PARENT_ID = "22222222-2222-2222-2222-222222222222";
const ALICE_ID = "33333333-3333-3333-3333-333333333333";
const BOB_ID = "44444444-4444-4444-4444-444444444444";

function poolWithReports(reports: Array<Record<string, unknown>>): Pool {
  return {
    query: jest.fn(() =>
      Promise.resolve({ rows: reports } as unknown as QueryResult),
    ),
  } as unknown as Pool;
}

function poolThatThrows(): Pool {
  return {
    query: jest.fn(() => Promise.reject(new Error("db down"))),
  } as unknown as Pool;
}

beforeEach(() => {
  mockRunAgentTurn.mockClear();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("createDelegateToSubagentTool", () => {
  it("returns null when the agent has no direct reports", async () => {
    const tool = await createDelegateToSubagentTool({
      pool: poolWithReports([]),
      workspaceId: WS_ID,
      userId: "user-1",
      parentAgentId: PARENT_ID,
    });
    expect(tool).toBeNull();
  });

  it("returns null on DB error (best-effort — manager runs aren't blocked)", async () => {
    const tool = await createDelegateToSubagentTool({
      pool: poolThatThrows(),
      workspaceId: WS_ID,
      userId: "user-1",
      parentAgentId: PARENT_ID,
    });
    expect(tool).toBeNull();
  });

  it("returns a tool whose description lists every direct report", async () => {
    const tool = await createDelegateToSubagentTool({
      pool: poolWithReports([
        { id: ALICE_ID, name: "Alice", role_key: "sdr", description: "" },
        { id: BOB_ID, name: "Bob", role_key: "marketer", description: "" },
      ]),
      workspaceId: WS_ID,
      userId: "user-1",
      parentAgentId: PARENT_ID,
    });
    expect(tool).not.toBeNull();
    expect(tool!.name).toBe("delegate_to_subagent");
    expect(tool!.description).toContain("Alice (sdr)");
    expect(tool!.description).toContain("Bob (marketer)");
  });

  it("invokes runAgentTurn for the matched report and forwards the reply", async () => {
    const tool = await createDelegateToSubagentTool({
      pool: poolWithReports([
        { id: ALICE_ID, name: "Alice", role_key: "sdr", description: "Run cold-outbound." },
      ]),
      workspaceId: WS_ID,
      userId: "user-1",
      parentAgentId: PARENT_ID,
    });
    const result = await tool!.handler({
      agent_name: "Alice",
      task: "Email the top 5 leads from the latest pull.",
    });
    expect(result).toMatchObject({ ok: true, agent: "Alice" });
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(1);
    const call = mockRunAgentTurn.mock.calls[0]![0];
    expect(call.agentId).toBe(ALICE_ID);
    expect(call.userPrompt).toContain("Email the top 5 leads");
  });

  it("matches the report's name case-insensitively", async () => {
    const tool = await createDelegateToSubagentTool({
      pool: poolWithReports([
        { id: ALICE_ID, name: "Alice", role_key: "sdr", description: "" },
      ]),
      workspaceId: WS_ID,
      userId: "user-1",
      parentAgentId: PARENT_ID,
    });
    const result = await tool!.handler({ agent_name: "ALICE", task: "Do it." });
    expect((result as { ok: boolean }).ok).toBe(true);
  });

  it("returns a structured error when the named report does not exist", async () => {
    const tool = await createDelegateToSubagentTool({
      pool: poolWithReports([
        { id: ALICE_ID, name: "Alice", role_key: "sdr", description: "" },
      ]),
      workspaceId: WS_ID,
      userId: "user-1",
      parentAgentId: PARENT_ID,
    });
    const result = (await tool!.handler({
      agent_name: "Mallory",
      task: "Do it.",
    })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No direct report named "Mallory"/);
    expect(mockRunAgentTurn).not.toHaveBeenCalled();
  });

  it("refuses delegation when depth has hit the cap", async () => {
    const tool = await createDelegateToSubagentTool({
      pool: poolWithReports([
        { id: ALICE_ID, name: "Alice", role_key: "sdr", description: "" },
      ]),
      workspaceId: WS_ID,
      userId: "user-1",
      parentAgentId: PARENT_ID,
      depth: MAX_DELEGATION_DEPTH,
    });
    const result = (await tool!.handler({
      agent_name: "Alice",
      task: "Do it.",
    })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Delegation depth.*hit the cap/);
    expect(mockRunAgentTurn).not.toHaveBeenCalled();
  });

  it("refuses to delegate to an agent already on the lineage stack (cycle prevention)", async () => {
    const tool = await createDelegateToSubagentTool({
      pool: poolWithReports([
        { id: ALICE_ID, name: "Alice", role_key: "sdr", description: "" },
      ]),
      workspaceId: WS_ID,
      userId: "user-1",
      parentAgentId: PARENT_ID,
      lineage: new Set<string>([ALICE_ID]),
    });
    const result = (await tool!.handler({
      agent_name: "Alice",
      task: "Do it.",
    })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already on the current delegation chain/);
  });

  it("propagates depth+1 and an extended lineage to the child runAgentTurn call", async () => {
    const tool = await createDelegateToSubagentTool({
      pool: poolWithReports([
        { id: ALICE_ID, name: "Alice", role_key: "sdr", description: "" },
      ]),
      workspaceId: WS_ID,
      userId: "user-1",
      parentAgentId: PARENT_ID,
      depth: 1,
    });
    await tool!.handler({ agent_name: "Alice", task: "Do it." });
    const call = mockRunAgentTurn.mock.calls[0]![0];
    expect(call.delegationDepth).toBe(2);
    const lineage = call.delegationLineage as ReadonlySet<string>;
    expect(lineage.has(PARENT_ID)).toBe(true);
  });

  it("rejects missing required args", async () => {
    const tool = await createDelegateToSubagentTool({
      pool: poolWithReports([
        { id: ALICE_ID, name: "Alice", role_key: "sdr", description: "" },
      ]),
      workspaceId: WS_ID,
      userId: "user-1",
      parentAgentId: PARENT_ID,
    });
    expect(((await tool!.handler({ task: "x" })) as { ok: boolean }).ok).toBe(false);
    expect(((await tool!.handler({ agent_name: "Alice" })) as { ok: boolean }).ok).toBe(false);
  });

  it("returns a structured error when the recursive runAgentTurn throws", async () => {
    mockRunAgentTurn.mockRejectedValueOnce(new Error("model timed out") as never);
    const tool = await createDelegateToSubagentTool({
      pool: poolWithReports([
        { id: ALICE_ID, name: "Alice", role_key: "sdr", description: "" },
      ]),
      workspaceId: WS_ID,
      userId: "user-1",
      parentAgentId: PARENT_ID,
    });
    const result = (await tool!.handler({
      agent_name: "Alice",
      task: "Do it.",
    })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Delegation to Alice failed: model timed out/);
  });
});
