import { agentTraceChannel, AgentTracePublisher, subscribeAgentTraceInMemory } from "./tracePublisher";
import type { AgentTraceScope, AgentTraceEnvelope } from "./types";

// Suppress Redis — tests run without a Redis connection.
jest.mock("../../queue/redisClient", () => ({
  getRedisClient: () => null,
}));

const SCOPE: AgentTraceScope = {
  workspaceId: "ws-1",
  agentId: "ag-1",
  runId: "run-1",
  turnId: "turn-1",
  provider: "anthropic",
  model: "claude-sonnet",
};

describe("agentTraceChannel", () => {
  it("builds the expected Redis channel name", () => {
    expect(agentTraceChannel("ws-abc")).toBe("workspace:ws-abc:agent-trace");
  });
});

describe("AgentTracePublisher", () => {
  it("publishes an envelope with sequential seq numbers", async () => {
    const publisher = new AgentTracePublisher({ ...SCOPE });
    const env1 = await publisher.publish({ type: "turn.started", at: "2026-01-01T00:00:00Z" });
    const env2 = await publisher.publish({ type: "iteration.started", iteration: 1 });
    expect(env1.seq).toBe(1);
    expect(env2.seq).toBe(2);
  });

  it("sets scope fields on every envelope", async () => {
    const publisher = new AgentTracePublisher({ ...SCOPE });
    const env = await publisher.publish({ type: "turn.started", at: "2026-01-01T00:00:00Z" });
    expect(env.workspaceId).toBe(SCOPE.workspaceId);
    expect(env.agentId).toBe(SCOPE.agentId);
    expect(env.runId).toBe(SCOPE.runId);
    expect(env.turnId).toBe(SCOPE.turnId);
    expect(env.provider).toBe(SCOPE.provider);
    expect(env.model).toBe(SCOPE.model);
  });

  it("sanitizes secret-shaped keys in tool_call.completed events", async () => {
    const publisher = new AgentTracePublisher({ ...SCOPE });
    const env = await publisher.publish({
      type: "tool_call.completed",
      callId: "c1",
      name: "fetch",
      arguments: { api_key: "sk-secret", url: "https://example.com" },
    });
    const event = env.event as Extract<typeof env.event, { type: "tool_call.completed" }>;
    expect(event.arguments.api_key).toBe("[redacted]");
    expect(event.arguments.url).toBe("https://example.com");
  });

  it("delivers envelope to in-memory subscribers", async () => {
    const publisher = new AgentTracePublisher({ ...SCOPE });
    const received: AgentTraceEnvelope[] = [];
    const unsub = subscribeAgentTraceInMemory(SCOPE.workspaceId, SCOPE.runId, (e) =>
      received.push(e),
    );
    await publisher.publish({ type: "turn.started", at: "2026-01-01T00:00:00Z" });
    unsub();
    expect(received).toHaveLength(1);
    expect(received[0]!.event.type).toBe("turn.started");
  });

  it("swallows errors from misbehaving in-memory subscribers", async () => {
    const publisher = new AgentTracePublisher({ ...SCOPE, runId: "run-err" });
    const unsub = subscribeAgentTraceInMemory("ws-1", "run-err", () => {
      throw new Error("bad subscriber");
    });
    await expect(
      publisher.publish({ type: "turn.started", at: "2026-01-01T00:00:00Z" }),
    ).resolves.toBeDefined();
    unsub();
  });

  it("createCallback returns a function that calls publish", async () => {
    const publisher = new AgentTracePublisher({ ...SCOPE, runId: "run-cb" });
    const cb = publisher.createCallback();
    // Invoke the callback — it fires-and-forgets, so we just verify it doesn't throw.
    expect(() => cb({ type: "turn.started", at: "2026-01-01T00:00:00Z" })).not.toThrow();
  });

  it("setIteration updates the scope iteration", async () => {
    const publisher = new AgentTracePublisher({ ...SCOPE, runId: "run-it" });
    publisher.setIteration(3);
    const env = await publisher.publish({ type: "iteration.started", iteration: 3 });
    expect(env.iteration).toBe(3);
  });
});

describe("subscribeAgentTraceInMemory", () => {
  it("returns an unsubscribe function that stops delivery", async () => {
    const publisher = new AgentTracePublisher({ ...SCOPE, runId: "run-unsub" });
    const received: AgentTraceEnvelope[] = [];
    const unsub = subscribeAgentTraceInMemory("ws-1", "run-unsub", (e) =>
      received.push(e),
    );
    await publisher.publish({ type: "turn.started", at: "2026-01-01T00:00:00Z" });
    unsub();
    await publisher.publish({ type: "iteration.started", iteration: 1 });
    expect(received).toHaveLength(1);
  });

  it("supports multiple subscribers on the same channel", async () => {
    const publisher = new AgentTracePublisher({ ...SCOPE, runId: "run-multi" });
    const calls1: number[] = [];
    const calls2: number[] = [];
    const unsub1 = subscribeAgentTraceInMemory("ws-1", "run-multi", (e) =>
      calls1.push(e.seq),
    );
    const unsub2 = subscribeAgentTraceInMemory("ws-1", "run-multi", (e) =>
      calls2.push(e.seq),
    );
    await publisher.publish({ type: "turn.started", at: "2026-01-01T00:00:00Z" });
    unsub1();
    unsub2();
    expect(calls1).toEqual([1]);
    expect(calls2).toEqual([1]);
  });
});
