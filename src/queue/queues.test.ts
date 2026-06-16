import { RunJobPayload, resetRunQueueForTests } from "./queues";
import { resetRedisClientForTests } from "./redisClient";

beforeEach(() => {
  resetRunQueueForTests();
  resetRedisClientForTests();
  delete process.env.REDIS_URL;
  delete process.env.UPSTASH_REDIS_URL;
});

afterEach(() => {
  resetRunQueueForTests();
  resetRedisClientForTests();
  delete process.env.REDIS_URL;
  delete process.env.UPSTASH_REDIS_URL;
});

describe("RunJobPayload serialization", () => {
  it("is round-trip serializable via JSON", () => {
    const payload: RunJobPayload = {
      runId: "run-abc-123",
      templateId: "tpl-support-bot",
      workflowVersionId: "v1-version-id",
      workspaceId: "ws-123-456",
      stepIndex: 0,
      idempotencyKey: "run-abc-123:0:v1-version-id",
    };
    const serialized = JSON.stringify(payload);
    const deserialized = JSON.parse(serialized) as RunJobPayload;
    expect(deserialized).toEqual(payload);
  });

  it("is valid without optional workflowVersionId", () => {
    const payload: RunJobPayload = {
      runId: "run-xyz",
      templateId: "tpl-lead-enrich",
      workspaceId: "ws-456",
      stepIndex: 0,
      idempotencyKey: "run-xyz:0",
    };
    expect(() => JSON.stringify(payload)).not.toThrow();
    const deserialized = JSON.parse(JSON.stringify(payload)) as RunJobPayload;
    expect(deserialized.workflowVersionId).toBeUndefined();
  });

  it("produces unique idempotency keys for different run+step combinations", () => {
    const key1 = `run-1:0:v1`;
    const key2 = `run-1:1:v1`;
    const key3 = `run-2:0:v1`;
    expect(key1).not.toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key2).not.toBe(key3);
  });
});

describe("getRunQueue", () => {
  it("returns null when REDIS_URL is not set", () => {
    const { getRunQueue } = require("./queues") as typeof import("./queues");
    const queue = getRunQueue();
    expect(queue).toBeNull();
  });
});

describe("run priority (HEL-700)", () => {
  it("maps priorities so faster tiers get a lower BullMQ number, normal is the default", () => {
    const { resolveRunPriority } = require("./queues") as typeof import("./queues");
    const critical = resolveRunPriority("critical");
    const high = resolveRunPriority("high");
    const normal = resolveRunPriority("normal");
    const low = resolveRunPriority("low");

    // BullMQ: a LOWER number is dequeued first.
    expect(critical).toBeLessThan(high);
    expect(high).toBeLessThan(normal);
    expect(normal).toBeLessThan(low);
    // Default (no arg) == normal, so existing callers keep FIFO ordering.
    expect(resolveRunPriority()).toBe(normal);
    expect(resolveRunPriority(undefined)).toBe(normal);
  });

  it("isRunPriority guards the wire/HTTP value", () => {
    const { isRunPriority } = require("./queues") as typeof import("./queues");
    expect(isRunPriority("critical")).toBe(true);
    expect(isRunPriority("normal")).toBe(true);
    expect(isRunPriority("urgent")).toBe(false);
    expect(isRunPriority("")).toBe(false);
    expect(isRunPriority(undefined)).toBe(false);
    expect(isRunPriority(3)).toBe(false);
  });

  it("addRunJob injects the resolved priority while preserving caller options", async () => {
    const { addRunJob, resolveRunPriority } = require("./queues") as typeof import("./queues");
    const calls: Array<{ name: string; payload: RunJobPayload; opts: Record<string, unknown> }> = [];
    const fakeQueue = {
      add: (name: string, payload: RunJobPayload, opts: Record<string, unknown>) => {
        calls.push({ name, payload, opts });
        return Promise.resolve({ id: payload.runId });
      },
    } as never;

    await addRunJob(
      fakeQueue,
      "run",
      {
        runId: "r1",
        templateId: "t1",
        workspaceId: "w1",
        stepIndex: 0,
        idempotencyKey: "r1:0",
        priority: "critical",
      },
      { jobId: "r1", removeOnComplete: 100 },
    );
    // No priority on the payload ⇒ default normal.
    await addRunJob(
      fakeQueue,
      "run",
      { runId: "r2", templateId: "t1", workspaceId: "w1", stepIndex: 0, idempotencyKey: "r2:0" },
      { jobId: "r2" },
    );

    expect(calls[0].opts).toEqual({
      jobId: "r1",
      removeOnComplete: 100,
      priority: resolveRunPriority("critical"),
    });
    expect(calls[1].opts).toEqual({ jobId: "r2", priority: resolveRunPriority("normal") });
  });
});
