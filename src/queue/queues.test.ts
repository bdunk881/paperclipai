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
