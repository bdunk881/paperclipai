jest.mock("./postgres", () => ({
  isPostgresConfigured: jest.fn(),
  queryPostgres: jest.fn(),
}));

import { isPostgresConfigured, queryPostgres } from "./postgres";
import {
  cleanupRuntimePersistenceHistory,
  getRuntimeRetentionDays,
  resetRuntimeRetentionStateForTests,
  scheduleRuntimePersistenceCleanup,
} from "./runtimeRetention";

const mockedIsPostgresConfigured = isPostgresConfigured as jest.MockedFunction<typeof isPostgresConfigured>;
const mockedQueryPostgres = queryPostgres as jest.MockedFunction<typeof queryPostgres>;

beforeEach(() => {
  delete process.env.WORKFLOW_RUNTIME_RETENTION_DAYS;
  resetRuntimeRetentionStateForTests();
  mockedIsPostgresConfigured.mockReset();
  mockedQueryPostgres.mockReset();
  mockedIsPostgresConfigured.mockReturnValue(true);
  mockedQueryPostgres.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe("getRuntimeRetentionDays", () => {
  it("returns null when the env var is unset", () => {
    expect(getRuntimeRetentionDays()).toBeNull();
  });

  it("parses a positive number of days", () => {
    process.env.WORKFLOW_RUNTIME_RETENTION_DAYS = "14";
    expect(getRuntimeRetentionDays()).toBe(14);
  });
});

describe("cleanupRuntimePersistenceHistory", () => {
  it("does nothing when retention is disabled", async () => {
    await cleanupRuntimePersistenceHistory(new Date("2026-04-20T00:00:00.000Z"));
    expect(mockedQueryPostgres).not.toHaveBeenCalled();
  });

  it("deletes stale rows from all runtime persistence tables", async () => {
    process.env.WORKFLOW_RUNTIME_RETENTION_DAYS = "7";

    await cleanupRuntimePersistenceHistory(new Date("2026-04-20T00:00:00.000Z"));

    expect(mockedQueryPostgres).toHaveBeenCalledTimes(4);
    expect(mockedQueryPostgres.mock.calls[0][0]).toMatch(/DELETE FROM workflow_queue_jobs/);
    expect(mockedQueryPostgres.mock.calls[1][0]).toMatch(/DELETE FROM approval_requests/);
    expect(mockedQueryPostgres.mock.calls[2][0]).toMatch(/DELETE FROM workflow_runs/);
    expect(mockedQueryPostgres.mock.calls[3][0]).toMatch(/DELETE FROM memory_entries/);
    expect(mockedQueryPostgres.mock.calls[0][1]).toEqual(["2026-04-13T00:00:00.000Z"]);
  });
});

describe("scheduleRuntimePersistenceCleanup", () => {
  it("throttles cleanup runs within the interval window", async () => {
    process.env.WORKFLOW_RUNTIME_RETENTION_DAYS = "7";

    const first = scheduleRuntimePersistenceCleanup(Date.parse("2026-04-20T00:00:00.000Z"));
    const second = scheduleRuntimePersistenceCleanup(Date.parse("2026-04-20T00:01:00.000Z"));

    expect(first).toBeInstanceOf(Promise);
    expect(second).toBe(first);
    await first;
    expect(mockedQueryPostgres).toHaveBeenCalledTimes(4);
  });
});
