import { defineRunStream, runProgressStream } from "./runStreams";
import {
  subscribeAgentStreamInMemory,
  resetWorkspaceStreamForTests,
  type WorkspaceStreamEnvelope,
} from "./agentTrace/streamPublisher";

describe("runStreams (HEL-709)", () => {
  beforeEach(() => resetWorkspaceStreamForTests());
  afterEach(() => resetWorkspaceStreamForTests());

  it("publishes a typed stream.chunk envelope scoped to the run", async () => {
    const captured: WorkspaceStreamEnvelope[] = [];
    const unsub = subscribeAgentStreamInMemory("ws-1", (e) => captured.push(e));
    const stream = defineRunStream<{ token: string }>("tokens");

    await stream.publish("ws-1", "run-1", { token: "hello" });
    unsub();

    expect(captured).toHaveLength(1);
    expect(captured[0]!.workspaceId).toBe("ws-1");
    expect(captured[0]!.event).toEqual({
      kind: "stream.chunk",
      runId: "run-1",
      streamName: "tokens",
      chunk: { token: "hello" },
    });
  });

  it("does not leak chunks to another workspace's subscriber", async () => {
    const other: WorkspaceStreamEnvelope[] = [];
    const unsub = subscribeAgentStreamInMemory("ws-2", (e) => other.push(e));
    await defineRunStream("tokens").publish("ws-1", "run-1", { token: "x" });
    unsub();
    expect(other).toHaveLength(0);
  });

  it("no-ops (returns null) without a workspace or run id", async () => {
    const chunk = { index: 0, stepId: "s", stepName: "S", status: "success" as const, durationMs: 1 };
    expect(await runProgressStream.publish("", "run-1", chunk)).toBeNull();
    expect(await runProgressStream.publish("ws-1", "", chunk)).toBeNull();
  });

  it("the built-in progress stream is named 'progress'", () => {
    expect(runProgressStream.name).toBe("progress");
  });
});
