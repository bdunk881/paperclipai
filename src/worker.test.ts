/**
 * Worker bootstrap smoke test — verifies that importing `worker.ts`
 * starts the singleton background sweeps (HEL-216 wires
 * planApprovalResumeCoordinator into the boot path so plan-mode
 * approvals actually resume their agents in production).
 *
 * The worker module has a lot of top-level side effects (BullMQ workers,
 * Redis connection, repeatable-job sync). This test mocks each of those
 * so the import doesn't actually open ports / talk to Redis.
 */

import { describe, expect, it, jest } from "@jest/globals";

const startSpy = jest.fn();
const stopSpy = jest.fn();
const syncRepeatableJobsSpy = jest.fn(async () => undefined);

// Stub out everything worker.ts touches at import time.
jest.mock("./agents/runtime/planApprovalResumeCoordinator", () => ({
  startPlanApprovalResumeCoordinator: (...args: unknown[]) => startSpy(...args),
  stopPlanApprovalResumeCoordinator: (...args: unknown[]) => stopSpy(...args),
}));

jest.mock("./queue/redisClient", () => ({
  getRedisClient: () => ({
    duplicate: () => ({ disconnect: () => undefined }),
    quit: async () => undefined,
  }),
}));

jest.mock("bullmq", () => {
  class FakeWorker {
    on() {
      return this;
    }
    async close() {
      return undefined;
    }
  }
  class FakeQueue {
    async add() {
      return undefined;
    }
    async close() {
      return undefined;
    }
  }
  return {
    Worker: FakeWorker,
    Queue: FakeQueue,
    Job: class {},
    // HEL infra dashboard PR #3: src/worker.ts now passes
    // `metrics: { maxDataPoints: MetricsTime.ONE_HOUR * 24 }` to Worker.
    // Mirror the enum's actual values so the multiplication doesn't NaN.
    MetricsTime: {
      ONE_MINUTE: 1,
      FIVE_MINUTES: 5,
      FIFTEEN_MINUTES: 15,
      THIRTY_MINUTES: 30,
      ONE_HOUR: 60,
      ONE_WEEK: 10080,
      TWO_WEEKS: 20160,
      ONE_MONTH: 80640,
    },
  };
});

jest.mock("./queue/scheduler", () => ({
  syncRepeatableJobs: (...args: unknown[]) => syncRepeatableJobsSpy(...(args as [])),
}));

jest.mock("./queue/queues", () => ({
  getRunQueue: () => ({ add: async () => undefined, close: async () => undefined }),
  getAgentPromptQueue: () => ({ add: async () => undefined, close: async () => undefined }),
  getDlqQueue: () => ({ add: async () => undefined, close: async () => undefined }),
  // HEL-700: scheduledWorkflowRun (reached via the cron handler) enqueues
  // through addRunJob; delegate to the mocked queue's add().
  addRunJob: (
    queue: { add: (...args: unknown[]) => unknown },
    name: string,
    payload: unknown,
    opts: unknown,
  ) => queue.add(name, payload, opts),
}));

jest.mock("./db/postgres", () => ({
  getPostgresPool: () => ({ query: async () => ({ rows: [] }) }),
  isPostgresConfigured: () => false,
  isPostgresPersistenceEnabled: () => false,
  inMemoryAllowed: () => true,
}));

describe("worker bootstrap", () => {
  it("starts the plan-approval resume coordinator on boot", () => {
    // Importing the worker module triggers its top-level side effects.
    // `jest.isolateModules` gives us a fresh module instance per test so
    // we can re-assert on the start hook.
    jest.isolateModules(() => {
      require("./worker");
    });
    expect(startSpy).toHaveBeenCalledTimes(1);
  });
});
