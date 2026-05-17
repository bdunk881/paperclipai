/**
 * Unit tests for src/queue/scheduler.ts (HEL-108).
 *
 * All BullMQ Queue calls are mocked — no real Redis connection needed.
 */

import type { Queue } from "bullmq";
import type { Pool, QueryResult } from "pg";
import {
  addRepeatableJob,
  removeRepeatableJob,
  syncRepeatableJobs,
} from "./scheduler";
import type { RunJobPayload } from "./queues";

function makeQueue(overrides: Partial<Queue<RunJobPayload>> = {}): Queue<RunJobPayload> {
  return {
    upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
    removeJobScheduler: jest.fn().mockResolvedValue(true),
    getJobSchedulers: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as Queue<RunJobPayload>;
}

function makePool(rows: unknown[]): Pool {
  return {
    query: jest.fn().mockResolvedValue({ rows } as unknown as QueryResult),
  } as unknown as Pool;
}

describe("addRepeatableJob", () => {
  it("calls upsertJobScheduler with the routine ID and cron pattern", async () => {
    const queue = makeQueue();
    await addRepeatableJob(queue, "routine-abc", "*/5 * * * *", "ws-1");
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    const [id, opts] = (queue.upsertJobScheduler as jest.Mock).mock.calls[0] as [string, { pattern: string }];
    expect(id).toBe("routine:routine-abc");
    expect(opts.pattern).toBe("*/5 * * * *");
  });
});

describe("removeRepeatableJob", () => {
  it("calls removeJobScheduler with the routine scheduler ID", async () => {
    const queue = makeQueue();
    await removeRepeatableJob(queue, "routine-abc");
    expect(queue.removeJobScheduler).toHaveBeenCalledWith("routine:routine-abc");
  });
});

describe("syncRepeatableJobs", () => {
  it("upserts a scheduler for each enabled cron routine", async () => {
    const queue = makeQueue();
    const pool = makePool([
      { id: "r1", schedule_cron: "0 * * * *", workspace_id: "ws-1" },
      { id: "r2", schedule_cron: "*/15 * * * *", workspace_id: "ws-2" },
    ]);

    await syncRepeatableJobs(queue, pool);

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2);
    const ids = (queue.upsertJobScheduler as jest.Mock).mock.calls.map(
      (c: unknown[]) => c[0] as string
    );
    expect(ids).toContain("routine:r1");
    expect(ids).toContain("routine:r2");
  });

  it("removes schedulers for routines no longer in the DB result", async () => {
    const queue = makeQueue({
      getJobSchedulers: jest.fn().mockResolvedValue([
        { id: "routine:r-stale" },
        { id: "routine:r1" },
      ]),
    });
    // Only r1 is active now; r-stale should be removed.
    const pool = makePool([
      { id: "r1", schedule_cron: "0 * * * *", workspace_id: "ws-1" },
    ]);

    await syncRepeatableJobs(queue, pool);

    expect(queue.removeJobScheduler).toHaveBeenCalledWith("routine:r-stale");
    expect(queue.removeJobScheduler).not.toHaveBeenCalledWith("routine:r1");
  });

  it("ignores non-routine scheduler keys during cleanup", async () => {
    const queue = makeQueue({
      getJobSchedulers: jest.fn().mockResolvedValue([
        { id: "some-other-scheduler" },
      ]),
    });
    const pool = makePool([]);

    await syncRepeatableJobs(queue, pool);

    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it("does nothing when there are no active routines and no stale schedulers", async () => {
    const queue = makeQueue();
    const pool = makePool([]);

    await syncRepeatableJobs(queue, pool);

    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });
});
