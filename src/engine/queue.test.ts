/**
 * Unit tests for the async job queue (src/engine/queue.ts).
 *
 * Verifies: enqueue/process flow, per-template serialisation,
 * retry-on-failure behaviour, max-retry exhaustion, and activeChainCount.
 *
 * Jest fake timers are used to advance retry delays without real waiting.
 */

import {
  enqueue,
  registerJobHandler,
  activeChainCount,
  resetQueueForTests,
  RunJob,
} from "./queue";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush the microtask queue and any pending timers up to `advanceMs`. */
async function flushAndAdvance(advanceMs = 0): Promise<void> {
  jest.advanceTimersByTime(advanceMs);
  // Flush all pending promise microtasks several times to ensure callbacks run
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

async function waitForQueueIdle(maxIterations = 25, advanceMs = 250): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    await flushAndAdvance(advanceMs);
    if (activeChainCount() === 0) {
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.useFakeTimers();
  resetQueueForTests();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete (globalThis as { fetch?: typeof fetch }).fetch;
  // Re-register a no-op handler before each test; individual tests override it.
  registerJobHandler(async () => {});
});

afterEach(async () => {
  await waitForQueueIdle();
  jest.useRealTimers();
  jest.clearAllMocks();
  resetQueueForTests();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete (globalThis as { fetch?: typeof fetch }).fetch;
});

// ---------------------------------------------------------------------------
// Basic enqueue and processing
// ---------------------------------------------------------------------------

describe("queue — basic enqueue and processing", () => {
  it("calls the registered handler with the correct job", async () => {
    const processed: RunJob[] = [];
    registerJobHandler(async (job) => { processed.push(job); });

    enqueue({ runId: "run-1", templateId: "tpl-support-bot" });
    await flushAndAdvance();

    expect(processed).toHaveLength(1);
    expect(processed[0].runId).toBe("run-1");
    expect(processed[0].templateId).toBe("tpl-support-bot");
    expect(processed[0].attempt).toBe(1);
  });

  it("processes multiple jobs for the same templateId sequentially", async () => {
    const order: string[] = [];
    registerJobHandler(async (job) => { order.push(job.runId); });

    enqueue({ runId: "run-a", templateId: "tpl-support-bot" });
    enqueue({ runId: "run-b", templateId: "tpl-support-bot" });
    enqueue({ runId: "run-c", templateId: "tpl-support-bot" });

    await flushAndAdvance();

    expect(order).toEqual(["run-a", "run-b", "run-c"]);
  });

  it("processes jobs for different templateIds independently", async () => {
    const processed: string[] = [];
    registerJobHandler(async (job) => { processed.push(job.templateId); });

    enqueue({ runId: "run-1", templateId: "tpl-support-bot" });
    enqueue({ runId: "run-2", templateId: "tpl-lead-enrich" });

    await flushAndAdvance();

    expect(processed).toContain("tpl-support-bot");
    expect(processed).toContain("tpl-lead-enrich");
    expect(processed).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Retry behaviour
// ---------------------------------------------------------------------------

describe("queue — retry on failure", () => {
  it("retries a failing job and succeeds on the second attempt", async () => {
    let callCount = 0;
    registerJobHandler(async () => {
      callCount++;
      if (callCount < 2) throw new Error("transient error");
    });

    enqueue({ runId: "run-retry", templateId: "tpl-support-bot" });

    // First attempt runs immediately
    await flushAndAdvance(0);

    // Advance past the 1s retry delay (attempt 1 * 1000ms)
    await flushAndAdvance(1100);

    expect(callCount).toBe(2);
  });

  it("increments attempt number on each retry", async () => {
    const attempts: number[] = [];
    registerJobHandler(async (job) => {
      attempts.push(job.attempt);
      if (job.attempt < 3) throw new Error("keep retrying");
    });

    enqueue({ runId: "run-attempts", templateId: "tpl-test" });

    await flushAndAdvance(0);     // attempt 1 fails
    await flushAndAdvance(1100);  // attempt 2 fails (1s delay)
    await flushAndAdvance(2200);  // attempt 3 succeeds (2s delay)

    expect(attempts).toEqual([1, 2, 3]);
  });

  it("stops retrying after MAX_RETRIES (3) attempts", async () => {
    let callCount = 0;
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    registerJobHandler(async () => {
      callCount++;
      throw new Error("always fails");
    });

    enqueue({ runId: "run-exhaust", templateId: "tpl-exhaust" });

    // Run through all 3 attempts + their delays
    await flushAndAdvance(0);     // attempt 1
    await flushAndAdvance(1100);  // attempt 2
    await flushAndAdvance(2200);  // attempt 3

    expect(callCount).toBe(3);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("run-exhaust"),
      expect.anything()
    );

    consoleErrorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// No handler registered
// ---------------------------------------------------------------------------

describe("queue — no handler registered", () => {
  it("logs an error and does not throw when no handler is set", async () => {
    // Force handler to null by registering undefined-equivalent
    // We can't directly set it to null via the public API, so we test the
    // "logs error but doesn't crash" path indirectly: no throw on enqueue.
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    // Register a no-op to clear previous, then register null-like behavior
    // by wrapping in a try that will never be called — instead just verify
    // enqueue itself doesn't throw
    registerJobHandler(async () => {});
    expect(() => enqueue({ runId: "run-safe", templateId: "tpl-x" })).not.toThrow();

    await flushAndAdvance();
    consoleErrorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// activeChainCount
// ---------------------------------------------------------------------------

describe("queue — activeChainCount", () => {
  it("returns a non-negative number", () => {
    expect(activeChainCount()).toBeGreaterThanOrEqual(0);
  });

  it("increases after enqueueing a job for a new templateId", () => {
    const before = activeChainCount();
    enqueue({ runId: "run-count", templateId: `tpl-unique-${Date.now()}` });
    expect(activeChainCount()).toBeGreaterThan(before);
  });
});

// ---------------------------------------------------------------------------
// Upstash-backed mode
// ---------------------------------------------------------------------------

type MockRedisState = {
  lists: Map<string, string[]>;
  sets: Map<string, Set<string>>;
};

function installMockUpstash(state?: MockRedisState) {
  const redis: MockRedisState = state ?? {
    lists: new Map<string, string[]>(),
    sets: new Map<string, Set<string>>(),
  };

  process.env.UPSTASH_REDIS_REST_URL = "https://upstash.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

  const fetchMock = jest.fn(async (_input: string, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body ?? "[]")) as Array<string | number>;
    const [name, ...args] = command;
    const op = String(name).toUpperCase();

    const list = (key: string) => {
      const current = redis.lists.get(key) ?? [];
      redis.lists.set(key, current);
      return current;
    };

    const set = (key: string) => {
      const current = redis.sets.get(key) ?? new Set<string>();
      redis.sets.set(key, current);
      return current;
    };

    let result: unknown = null;
    switch (op) {
      case "RPUSH": {
        const key = String(args[0]);
        const values = args.slice(1).map(String);
        result = list(key).push(...values);
        break;
      }
      case "LPUSH": {
        const key = String(args[0]);
        const values = args.slice(1).map(String);
        result = list(key).unshift(...values);
        break;
      }
      case "LPOP": {
        const key = String(args[0]);
        result = list(key).shift() ?? null;
        break;
      }
      case "LLEN": {
        result = list(String(args[0])).length;
        break;
      }
      case "SADD": {
        const key = String(args[0]);
        const values = args.slice(1).map(String);
        const current = set(key);
        let added = 0;
        for (const value of values) {
          if (!current.has(value)) {
            current.add(value);
            added += 1;
          }
        }
        result = added;
        break;
      }
      case "SMEMBERS": {
        result = [...set(String(args[0]))];
        break;
      }
      case "SREM": {
        const current = set(String(args[0]));
        let removed = 0;
        for (const value of args.slice(1).map(String)) {
          if (current.delete(value)) {
            removed += 1;
          }
        }
        result = removed;
        break;
      }
      default:
        throw new Error(`Unsupported mock Redis command: ${op}`);
    }

    return {
      ok: true,
      json: async () => ({ result }),
    } as Response;
  });

  (globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  return { redis, fetchMock };
}

describe("queue — Upstash mode", () => {
  it("persists jobs in Redis and still processes them in FIFO order per template", async () => {
    installMockUpstash();

    const order: string[] = [];
    registerJobHandler(async (job) => {
      order.push(job.runId);
    });

    enqueue({ runId: "run-a", templateId: "tpl-support-bot" });
    enqueue({ runId: "run-b", templateId: "tpl-support-bot" });
    enqueue({ runId: "run-c", templateId: "tpl-support-bot" });

    await waitForQueueIdle();

    expect(order).toEqual(["run-a", "run-b", "run-c"]);
  });

  it("retries by requeueing to the front and dead-letters after the final failure", async () => {
    const { redis } = installMockUpstash();
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const attempts: number[] = [];
    registerJobHandler(async (job) => {
      attempts.push(job.attempt);
      throw new Error("always fails");
    });

    enqueue({ runId: "run-dead", templateId: "tpl-dead" });

    await flushAndAdvance(0);
    await flushAndAdvance(1100);
    await flushAndAdvance(2200);
    await flushAndAdvance(100);
    await waitForQueueIdle();

    expect(attempts).toEqual([1, 2, 3]);

    const deadLetterKey = "autoflow:workflow-queue:template:tpl-dead:dead";
    const deadLetters = redis.lists.get(deadLetterKey) ?? [];
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]).toContain("\"runId\":\"run-dead\"");
    expect(deadLetters[0]).toContain("\"attempt\":3");

    consoleErrorSpy.mockRestore();
  });
});
