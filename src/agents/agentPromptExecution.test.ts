/**
 * Unit tests for `executeAgentPrompt` (HEL-174).
 *
 * Covers the persistence behaviour: runs row + ticket_updates write-back
 * + activity event emission. The actual LLM call is mocked through
 * `runAgentTurn` so we test the wrapper plumbing, not the provider.
 */

import type { Pool, QueryResult } from "pg";
import { executeAgentPrompt } from "./agentPromptExecution";

// Mock runAgentTurn so tests don't hit the LLM provider stack.
jest.mock("./runAgentTurn", () => ({
  runAgentTurn: jest.fn(),
}));

import { runAgentTurn } from "./runAgentTurn";

const AGENT_ID = "00000000-0000-4000-8000-000000000001";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";
const TICKET_ID = "00000000-0000-4000-8000-000000000003";
const USER_ID = "user-abc";

const AGENT_ROW = {
  id: AGENT_ID,
  workspace_id: WORKSPACE_ID,
  user_id: USER_ID,
  team_id: "00000000-0000-4000-8000-000000000004",
  name: "Marketing Agent",
  role_key: "marketing-analyst",
  instructions: "You are a marketing analyst. Be concise.",
  model: "claude-sonnet",
};

interface QueryRecorder {
  calls: Array<{ sql: string; params: unknown[] }>;
  responses: Array<QueryResult>;
}

function makePool(responses: Array<QueryResult | Error>): Pool & { _recorder: QueryRecorder } {
  const recorder: QueryRecorder = { calls: [], responses: responses as QueryResult[] };
  let idx = 0;
  const pool = {
    query: jest.fn((sql: string, params?: unknown[]) => {
      recorder.calls.push({ sql, params: params ?? [] });
      const next = responses[idx++];
      if (!next) {
        return Promise.resolve({ rows: [], rowCount: 0 } as unknown as QueryResult);
      }
      if (next instanceof Error) {
        return Promise.reject(next);
      }
      return Promise.resolve(next);
    }),
  } as unknown as Pool & { _recorder: QueryRecorder };
  pool._recorder = recorder;
  return pool;
}

describe("executeAgentPrompt", () => {
  beforeEach(() => {
    (runAgentTurn as jest.Mock).mockReset();
  });

  it("persists a prompt-backed run row and emits an activity event for a schedule trigger", async () => {
    (runAgentTurn as jest.Mock).mockResolvedValue({
      text: "Analyzed last week's performance.\nACTION_SUMMARY: Generated weekly summary report.",
      usage: { promptTokens: 120, completionTokens: 80 },
      provider: "anthropic",
      model: "claude-sonnet",
    });
    // HEL-175 changed the call sequence:
    //   1. SELECT agent
    //   2. INSERT runs (running)
    //   3. SELECT runs (cancellation check #1)  [returns running]
    //   4. SELECT runs (cancellation check #2)  [returns running]
    //   5. UPDATE runs (finalize)
    //   6. INSERT activity_events
    const pool = makePool([
      { rows: [AGENT_ROW], rowCount: 1 } as unknown as QueryResult,
      { rows: [], rowCount: 1 } as unknown as QueryResult,
      { rows: [{ status: "running" }], rowCount: 1 } as unknown as QueryResult,
      { rows: [{ status: "running" }], rowCount: 1 } as unknown as QueryResult,
      { rows: [], rowCount: 1 } as unknown as QueryResult,
      { rows: [], rowCount: 1 } as unknown as QueryResult,
    ]);

    const result = await executeAgentPrompt({
      pool,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      agentId: AGENT_ID,
      prompt: "Generate this week's marketing summary.",
      llmTier: "standard",
      sourceRoutineId: "00000000-0000-4000-8000-000000000099",
      triggerKind: "schedule",
    });

    expect(result.needsHumanInput).toBe(false);
    expect(result.cancelled).toBeUndefined();
    expect(runAgentTurn).toHaveBeenCalledTimes(1);
    const runArg = (runAgentTurn as jest.Mock).mock.calls[0]![0];
    expect(runArg.agentName).toBe("Marketing Agent");
    expect(runArg.systemPrompt).toContain("Marketing Agent");
    expect(runArg.systemPrompt).toContain("scheduled routine");

    // INSERT runs (running) — call index 1.
    const runInsertCall = pool._recorder.calls[1]!;
    expect(runInsertCall.sql).toContain("INSERT INTO runs");
    expect(runInsertCall.sql).toContain("'running'");
    expect(runInsertCall.params[6]).toBe("Generate this week's marketing summary.");

    // UPDATE runs (finalize) — call index 4.
    const finalizeCall = pool._recorder.calls[4]!;
    expect(finalizeCall.sql).toContain("UPDATE runs");
    expect(finalizeCall.sql).toContain("SET status");
    expect(finalizeCall.params[1]).toBe("completed");

    // Activity event INSERT — call index 5.
    const activityCall = pool._recorder.calls[5]!;
    expect(activityCall.sql).toContain("INSERT INTO activity_events");
  });

  it("appends a structured_update + flips ticket status when sourceTicketId is provided", async () => {
    (runAgentTurn as jest.Mock).mockResolvedValue({
      text: "Looked up the data.\nACTION_SUMMARY: Pulled a marketing summary report.",
      usage: { promptTokens: 200, completionTokens: 150 },
      provider: "anthropic",
      model: "claude-sonnet",
    });
    // HEL-175 call sequence with sourceTicketId:
    //   1. SELECT agent
    //   2. INSERT runs (running)
    //   3. SELECT runs (cancel check #1)
    //   4. SELECT runs (cancel check #2)
    //   5. UPDATE runs (finalize)
    //   6. INSERT ticket_updates (structured_update)
    //   7. UPDATE tickets (in_progress)
    //   8. INSERT activity_events
    const pool = makePool([
      { rows: [AGENT_ROW], rowCount: 1 } as unknown as QueryResult,
      { rows: [], rowCount: 1 } as unknown as QueryResult,
      { rows: [{ status: "running" }], rowCount: 1 } as unknown as QueryResult,
      { rows: [{ status: "running" }], rowCount: 1 } as unknown as QueryResult,
      { rows: [], rowCount: 1 } as unknown as QueryResult,
      { rows: [], rowCount: 1 } as unknown as QueryResult,
      { rows: [], rowCount: 1 } as unknown as QueryResult,
      { rows: [], rowCount: 1 } as unknown as QueryResult,
    ]);

    const result = await executeAgentPrompt({
      pool,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      agentId: AGENT_ID,
      prompt: "Pull the latest marketing data.",
      sourceTicketId: TICKET_ID,
      triggerKind: "assignment",
    });

    expect(result.needsHumanInput).toBe(false);

    // ticket_updates INSERT — call index 5 (was 2 pre-HEL-175).
    const updateInsertCall = pool._recorder.calls[5]!;
    expect(updateInsertCall.sql).toContain("INSERT INTO ticket_updates");
    expect(updateInsertCall.sql).toContain("'structured_update'");
    expect(updateInsertCall.params[0]).toBe(TICKET_ID);
    expect(updateInsertCall.params[1]).toBe(AGENT_ID);

    // tickets UPDATE — call index 6.
    const ticketUpdateCall = pool._recorder.calls[6]!;
    expect(ticketUpdateCall.sql).toContain("UPDATE tickets");
    expect(ticketUpdateCall.sql).toContain("status = 'in_progress'");
  });

  it("flags needsHumanInput when the agent ends with NEEDS_HUMAN_INPUT", async () => {
    (runAgentTurn as jest.Mock).mockResolvedValue({
      text: "Cannot continue without the API key.\nNEEDS_HUMAN_INPUT: Connect the HubSpot integration first.",
      usage: { promptTokens: 60, completionTokens: 30 },
      provider: "anthropic",
      model: "claude-sonnet",
    });
    const pool = makePool([
      { rows: [AGENT_ROW], rowCount: 1 } as unknown as QueryResult, // agent
      { rows: [], rowCount: 1 } as unknown as QueryResult, // INSERT runs
      { rows: [{ status: "running" }], rowCount: 1 } as unknown as QueryResult, // cancel check #1
      { rows: [{ status: "running" }], rowCount: 1 } as unknown as QueryResult, // cancel check #2
      { rows: [], rowCount: 1 } as unknown as QueryResult, // UPDATE runs (finalize)
      { rows: [], rowCount: 1 } as unknown as QueryResult, // ticket_update
      { rows: [], rowCount: 0 } as unknown as QueryResult, // ticket status update
      { rows: [], rowCount: 1 } as unknown as QueryResult, // activity
    ]);

    const result = await executeAgentPrompt({
      pool,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      agentId: AGENT_ID,
      prompt: "Pull the marketing report.",
      sourceTicketId: TICKET_ID,
      triggerKind: "assignment_update",
    });

    expect(result.needsHumanInput).toBe(true);
    // UPDATE runs (finalize) writes status="escalated" — call index 4.
    const finalizeCall = pool._recorder.calls[4]!;
    expect(finalizeCall.sql).toContain("UPDATE runs");
    expect(finalizeCall.params[1]).toBe("escalated");
  });

  // HEL-175: cooperative cancellation paths.
  it("returns cancelled=true and skips the LLM call when cancellation is requested before runAgentTurn", async () => {
    const pool = makePool([
      { rows: [AGENT_ROW], rowCount: 1 } as unknown as QueryResult, // agent
      { rows: [], rowCount: 1 } as unknown as QueryResult, // INSERT runs
      { rows: [{ status: "cancelling" }], rowCount: 1 } as unknown as QueryResult, // cancel check #1 — flipped
      { rows: [], rowCount: 1 } as unknown as QueryResult, // UPDATE runs (finalize → canceled)
    ]);

    const result = await executeAgentPrompt({
      pool,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      agentId: AGENT_ID,
      prompt: "Long-running task that user wants to abort.",
      sourceRoutineId: "00000000-0000-4000-8000-000000000099",
      triggerKind: "schedule",
    });

    expect(result.cancelled).toBe(true);
    expect(result.needsHumanInput).toBe(false);
    expect(runAgentTurn).not.toHaveBeenCalled();

    // UPDATE runs to canceled — call index 3.
    const finalizeCall = pool._recorder.calls[3]!;
    expect(finalizeCall.sql).toContain("UPDATE runs");
    expect(finalizeCall.params[1]).toBe("canceled");
  });

  it("returns cancelled=true after the LLM call when cancellation was requested mid-flight", async () => {
    (runAgentTurn as jest.Mock).mockResolvedValue({
      text: "Some result that will be discarded.",
      usage: { promptTokens: 50, completionTokens: 25 },
      provider: "anthropic",
      model: "claude-sonnet",
    });
    const pool = makePool([
      { rows: [AGENT_ROW], rowCount: 1 } as unknown as QueryResult, // agent
      { rows: [], rowCount: 1 } as unknown as QueryResult, // INSERT runs
      { rows: [{ status: "running" }], rowCount: 1 } as unknown as QueryResult, // cancel check #1
      { rows: [{ status: "cancelling" }], rowCount: 1 } as unknown as QueryResult, // cancel check #2 — flipped post-LLM
      { rows: [], rowCount: 1 } as unknown as QueryResult, // UPDATE runs (finalize → canceled)
    ]);

    const result = await executeAgentPrompt({
      pool,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      agentId: AGENT_ID,
      prompt: "Pull the marketing report.",
      triggerKind: "manual",
    });

    expect(result.cancelled).toBe(true);
    expect(runAgentTurn).toHaveBeenCalledTimes(1); // LLM was called — cost was paid
    // The result text from runAgentTurn IS surfaced (cost was paid; caller
    // can inspect it for debugging) but the cancelled flag tells them to
    // discard.
    expect(result.result).toBe("Some result that will be discarded.");

    const finalizeCall = pool._recorder.calls[4]!;
    expect(finalizeCall.sql).toContain("UPDATE runs");
    expect(finalizeCall.params[1]).toBe("canceled");
  });

  it("throws agent_not_found when the agent row is missing", async () => {
    const pool = makePool([{ rows: [], rowCount: 0 } as unknown as QueryResult]);
    await expect(
      executeAgentPrompt({
        pool,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        agentId: AGENT_ID,
        prompt: "do something",
        triggerKind: "manual",
      }),
    ).rejects.toThrow(/agent_not_found/);
  });
});
