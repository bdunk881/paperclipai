/**
 * HEL-492: scheduleMemoryConsolidation records a real action_result episode
 * (previously a no-op stub) so the batched reflection job can later consolidate
 * agent prompt runs into knowledge.
 *
 * Wiring-level test: saveMemory's DB/embedding internals are covered by its own
 * suite; here we assert the consolidation helper hands saveMemory a correct
 * `episode` / `action_result` write that reflection can pick up.
 */

import { scheduleMemoryConsolidation } from "./agentPromptExecution";
import { saveMemory } from "../knowledge/saveMemoryTool";
import { embedTextForWorkspace } from "../knowledge/reflectionWiring";
import type { Pool } from "pg";

jest.mock("../knowledge/saveMemoryTool", () => ({
  saveMemory: jest.fn(async () => ({
    ok: true,
    id: "episode-1",
    layer: "episode",
    supersededIds: [],
  })),
}));

jest.mock("../knowledge/reflectionWiring", () => ({
  embedTextForWorkspace: jest.fn(async () => [0.1, 0.2, 0.3]),
}));

const mockedSaveMemory = saveMemory as jest.MockedFunction<typeof saveMemory>;
const mockedEmbed = embedTextForWorkspace as jest.MockedFunction<typeof embedTextForWorkspace>;

const baseInput = {
  pool: {} as Pool,
  workspaceId: "ws-1",
  agentId: "agent-1",
  userId: "user-1",
  runId: "run-1",
  actionSummary: "Resolved the refund request",
  fullReply: "Issued a full refund and emailed the customer a confirmation.",
};

describe("scheduleMemoryConsolidation (HEL-492)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("records an action_result episode reflection can later consolidate", async () => {
    await scheduleMemoryConsolidation(baseInput);

    expect(mockedSaveMemory).toHaveBeenCalledTimes(1);
    const [args, ctx] = mockedSaveMemory.mock.calls[0];
    expect(args).toMatchObject({
      layer: "episode",
      kind: "action_result",
      title: "Resolved the refund request",
      content: "Issued a full refund and emailed the customer a confirmation.",
      run_id: "run-1",
    });
    expect(ctx).toMatchObject({
      workspaceId: "ws-1",
      agentId: "agent-1",
      userId: "user-1",
      canWriteAuthoritative: false,
    });
    expect(typeof ctx.embedFn).toBe("function");
  });

  it("truncates title to 80 and content to 2000 chars (saveMemory's caps)", async () => {
    await scheduleMemoryConsolidation({
      ...baseInput,
      actionSummary: "a".repeat(200),
      fullReply: "b".repeat(5000),
    });
    const [args] = mockedSaveMemory.mock.calls[0];
    expect(args.title).toHaveLength(80);
    expect(args.content).toHaveLength(2000);
  });

  it("skips the write when there is no substantive content", async () => {
    await scheduleMemoryConsolidation({ ...baseInput, fullReply: "   " });
    expect(mockedSaveMemory).not.toHaveBeenCalled();
  });

  it("is best-effort: swallows saveMemory failures and never throws", async () => {
    mockedSaveMemory.mockRejectedValueOnce(new Error("db down"));
    await expect(scheduleMemoryConsolidation(baseInput)).resolves.toBeUndefined();
  });

  it("wires an embedFn that delegates to the workspace tier-routed embedder", async () => {
    await scheduleMemoryConsolidation(baseInput);
    const [, ctx] = mockedSaveMemory.mock.calls[0];
    await ctx.embedFn("hello", { provider: "openai" } as never);
    expect(mockedEmbed).toHaveBeenCalledWith({ workspaceId: "ws-1", userId: "user-1" }, "hello");
  });
});
