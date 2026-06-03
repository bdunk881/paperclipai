/**
 * HEL-458 / B1 — coordinator advisory-lock helper.
 */

const clientQuery = jest.fn();
const release = jest.fn();
const connect = jest.fn(async () => ({ query: clientQuery, release }));

jest.mock("../db/postgres", () => ({
  isPostgresConfigured: jest.fn(),
  getPostgresPool: () => ({ connect }),
}));

import { isPostgresConfigured } from "../db/postgres";
import { runWithAdvisoryLock } from "./coordinatorLock";

const mockIsPgConfigured = jest.mocked(isPostgresConfigured);

beforeEach(() => {
  clientQuery.mockReset();
  release.mockReset();
  connect.mockClear();
  mockIsPgConfigured.mockReset();
});

describe("runWithAdvisoryLock", () => {
  it("runs fn directly (no lock) when Postgres is not configured", async () => {
    mockIsPgConfigured.mockReturnValue(false);
    const fn = jest.fn(async () => {});
    const ran = await runWithAdvisoryLock(42, fn);
    expect(ran).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
  });

  it("acquires the lock, runs fn, then unlocks + releases", async () => {
    mockIsPgConfigured.mockReturnValue(true);
    clientQuery.mockImplementation(async (sql: string) =>
      sql.includes("pg_try_advisory_lock") ? { rows: [{ locked: true }] } : { rows: [] },
    );
    const fn = jest.fn(async () => {});
    const ran = await runWithAdvisoryLock(42, fn);
    expect(ran).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(clientQuery).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [42]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("skips fn when another instance holds the lock", async () => {
    mockIsPgConfigured.mockReturnValue(true);
    clientQuery.mockResolvedValue({ rows: [{ locked: false }] });
    const fn = jest.fn(async () => {});
    const ran = await runWithAdvisoryLock(42, fn);
    expect(ran).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    // No unlock when we never acquired the lock.
    expect(clientQuery).not.toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [42]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("degrades to running fn if the lock query throws (DB blip)", async () => {
    mockIsPgConfigured.mockReturnValue(true);
    clientQuery.mockRejectedValueOnce(new Error("connection reset"));
    const fn = jest.fn(async () => {});
    const ran = await runWithAdvisoryLock(42, fn);
    expect(ran).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
