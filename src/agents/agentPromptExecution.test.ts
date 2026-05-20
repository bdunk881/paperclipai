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
    const pool = makePool([
      // 1: load agent
      { rows: [AGENT_ROW], rowCount: 1 } as unknown as QueryResult,
      // 2: insert run
      { rows: [], rowCount: 1 } as unknown as QueryResult,
      // 3: insert activity event
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
    expect(runAgentTurn).toHaveBeenCalledTimes(1);
    const runArg = (runAgentTurn as jest.Mock).mock.calls[0]![0];
    expect(runArg.agentName).toBe("Marketing Agent");
    expect(runArg.systemPrompt).toContain("Marketing Agent");
    expect(runArg.systemPrompt).toContain("scheduled routine");

    // Verify run-row INSERT used prompt mode (not workflow_version_id).
    const runInsertCall = pool._recorder.calls[1]!;
    expect(runInsertCall.sql).toContain("INSERT INTO runs");
    expect(runInsertCall.sql).toContain("workflow_version_id, status,");
    // Params: id, workspaceId, routineId, status, startedAt, input,
    // output, error, userId, prompt, sourceTicketId.
    expect(runInsertCall.params[3]).toBe("completed");
    expect(runInsertCall.params[9]).toBe("Generate this week's marketing summary.");

    // Verify activity event INSERT.
    const activityCall = pool._recorder.calls[2]!;
    expect(activityCall.sql).toContain("INSERT INTO activity_events");
  });

  it("appends a structured_update + flips ticket status when sourceTicketId is provided", async () => {
    (runAgentTurn as jest.Mock).mockResolvedValue({
      text: "Looked up the data.\nACTION_SUMMARY: Pulled a marketing summary report.",
      usage: { promptTokens: 200, completionTokens: 150 },
      provider: "anthropic",
      model: "claude-sonnet",
    });
    const pool = makePool([
      // 1: load agent
      { rows: [AGENT_ROW], rowCount: 1 } as unknown as QueryResult,
      // 2: insert run
      { rows: [], rowCount: 1 } as unknown as QueryResult,
      // 3: insert ticket_update
      { rows: [], rowCount: 1 } as unknown as QueryResult,
      // 4: UPDATE tickets SET status='in_progress'
      { rows: [], rowCount: 1 } as unknown as QueryResult,
      // 5: insert activity event
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

    const updateInsertCall = pool._recorder.calls[2]!;
    expect(updateInsertCall.sql).toContain("INSERT INTO ticket_updates");
    expect(updateInsertCall.sql).toContain("'structured_update'");
    expect(updateInsertCall.params[0]).toBe(TICKET_ID);
    expect(updateInsertCall.params[1]).toBe(AGENT_ID);

    const ticketUpdateCall = pool._recorder.calls[3]!;
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
      { rows: [], rowCount: 1 } as unknown as QueryResult, // run
      { rows: [], rowCount: 1 } as unknown as QueryResult, // ticket update
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
    // Run row status should be "escalated".
    const runInsertCall = pool._recorder.calls[1]!;
    expect(runInsertCall.params[3]).toBe("escalated");
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
