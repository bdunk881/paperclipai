import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockGetRedisClient =
  jest.fn<() => ReturnType<typeof import("../../queue/redisClient").getRedisClient>>(
    () => null,
  );
jest.mock("../../queue/redisClient", () => ({
  getRedisClient: () => mockGetRedisClient(),
}));

import {
  agentStreamChannel,
  publishWorkspaceStreamEvent,
  resetWorkspaceStreamForTests,
  subscribeAgentStreamInMemory,
  type WorkspaceStreamEnvelope,
} from "./streamPublisher";

describe("workspace stream publisher", () => {
  const workspaceId = "ws-1";

  beforeEach(() => {
    resetWorkspaceStreamForTests();
  });

  afterEach(() => {
    resetWorkspaceStreamForTests();
  });

  it("delivers published events to an in-memory subscriber", async () => {
    const received: WorkspaceStreamEnvelope[] = [];
    const unsubscribe = subscribeAgentStreamInMemory(workspaceId, (e) =>
      received.push(e),
    );

    await publishWorkspaceStreamEvent(workspaceId, {
      kind: "run.lifecycle",
      phase: "started",
      runId: "run-1",
      agentId: "agent-1",
      routineId: "routine-1",
      ticketId: null,
    });

    unsubscribe();

    expect(received).toHaveLength(1);
    expect(received[0]?.event.kind).toBe("run.lifecycle");
    expect(received[0]?.seq).toBe(1);
    expect(received[0]?.workspaceId).toBe(workspaceId);
  });

  it("increments seq per workspace independently", async () => {
    const a: WorkspaceStreamEnvelope[] = [];
    const b: WorkspaceStreamEnvelope[] = [];
    subscribeAgentStreamInMemory("ws-A", (e) => a.push(e));
    subscribeAgentStreamInMemory("ws-B", (e) => b.push(e));

    await publishWorkspaceStreamEvent("ws-A", {
      kind: "activity.event",
      activityKind: "agent.prompt_executed",
    });
    await publishWorkspaceStreamEvent("ws-A", {
      kind: "activity.event",
      activityKind: "agent.prompt_executed",
    });
    await publishWorkspaceStreamEvent("ws-B", {
      kind: "activity.event",
      activityKind: "agent.prompt_executed",
    });

    expect(a.map((e) => e.seq)).toEqual([1, 2]);
    expect(b.map((e) => e.seq)).toEqual([1]);
  });

  it("does not break the publish path when a subscriber throws", async () => {
    const reachedSecond: WorkspaceStreamEnvelope[] = [];
    subscribeAgentStreamInMemory(workspaceId, () => {
      throw new Error("subscriber blew up");
    });
    subscribeAgentStreamInMemory(workspaceId, (e) => reachedSecond.push(e));

    await expect(
      publishWorkspaceStreamEvent(workspaceId, {
        kind: "ticket.update.appended",
        ticketId: "ticket-1",
        updateId: "update-1",
        updateType: "structured_update",
        actor: { type: "agent", id: "agent-1" },
      }),
    ).resolves.toBeTruthy();

    expect(reachedSecond).toHaveLength(1);
  });

  it("stops delivering to an unsubscribed handler", async () => {
    const received: WorkspaceStreamEnvelope[] = [];
    const unsubscribe = subscribeAgentStreamInMemory(workspaceId, (e) =>
      received.push(e),
    );

    await publishWorkspaceStreamEvent(workspaceId, {
      kind: "ticket.created",
      ticketId: "ticket-1",
      title: "x",
      status: "open",
      priority: "medium",
      creatorId: "u",
      assignees: [],
    });
    unsubscribe();
    await publishWorkspaceStreamEvent(workspaceId, {
      kind: "ticket.created",
      ticketId: "ticket-2",
      title: "y",
      status: "open",
      priority: "medium",
      creatorId: "u",
      assignees: [],
    });

    expect(received).toHaveLength(1);
  });

  it("builds the expected workspace stream channel name", () => {
    expect(agentStreamChannel("ws-xyz")).toBe("workspace:ws-xyz:agent-stream");
  });

  it("publishes to redis when a client is available", async () => {
    const publish = jest.fn<(channel: string, message: string) => Promise<number>>(
      async () => 1,
    );
    mockGetRedisClient.mockReturnValueOnce({ publish } as never);

    await publishWorkspaceStreamEvent("ws-redis", {
      kind: "activity.event",
      activityKind: "agent.prompt_executed",
    });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0]).toBe("workspace:ws-redis:agent-stream");
    mockGetRedisClient.mockReturnValue(null);
  });

  it("logs and continues when redis publish rejects", async () => {
    const publish = jest.fn<(channel: string, message: string) => Promise<number>>(
      async () => {
        throw new Error("redis exploded");
      },
    );
    mockGetRedisClient.mockReturnValueOnce({ publish } as never);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      publishWorkspaceStreamEvent("ws-redis-err", {
        kind: "activity.event",
        activityKind: "agent.prompt_executed",
      }),
    ).resolves.toBeTruthy();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[agentStream] publish failed"),
    );
    warn.mockRestore();
    mockGetRedisClient.mockReturnValue(null);
  });
});
