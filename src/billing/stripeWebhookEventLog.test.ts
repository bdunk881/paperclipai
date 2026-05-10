import type { Pool, QueryResult } from "pg";

// Mock postgres helpers BEFORE importing the SUT so the module-level
// guard reads the mock state.
const mockIsPostgresPersistenceEnabled = jest.fn();
const mockInMemoryAllowed = jest.fn();
const mockGetPostgresPool = jest.fn();

jest.mock("../db/postgres", () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  inMemoryAllowed: () => mockInMemoryAllowed(),
  isPostgresPersistenceEnabled: () => mockIsPostgresPersistenceEnabled(),
}));

import { recordEventOnce, hasNewerEventForResource } from "./stripeWebhookEventLog";

function queryResult<T extends Record<string, unknown>>(
  rows: T[],
  rowCount: number | null = rows.length,
): QueryResult<T> {
  return {
    command: rows.length > 0 ? "INSERT" : "SELECT",
    rowCount,
    oid: 0,
    fields: [],
    rows,
  };
}

describe("stripeWebhookEventLog", () => {
  beforeEach(() => {
    mockIsPostgresPersistenceEnabled.mockReset();
    mockInMemoryAllowed.mockReset();
    mockGetPostgresPool.mockReset();
  });

  describe("recordEventOnce", () => {
    it("returns true when the row is inserted (xmax=0)", async () => {
      mockIsPostgresPersistenceEnabled.mockReturnValue(true);
      const query = jest
        .fn()
        .mockResolvedValueOnce(queryResult([{ inserted: true }], 1));
      mockGetPostgresPool.mockReturnValue({ query } as unknown as Pool);

      const result = await recordEventOnce("evt_1", "customer.subscription.updated", 1700000000, "sub_a");

      expect(result).toBe(true);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("ON CONFLICT (event_id) DO NOTHING"),
        ["evt_1", "customer.subscription.updated", 1700000000, "sub_a"],
      );
    });

    it("returns false when the row already existed (no rows returned)", async () => {
      mockIsPostgresPersistenceEnabled.mockReturnValue(true);
      const query = jest.fn().mockResolvedValueOnce(queryResult([], 0));
      mockGetPostgresPool.mockReturnValue({ query } as unknown as Pool);

      const result = await recordEventOnce("evt_dup", "customer.subscription.updated", 1700000000, "sub_a");

      expect(result).toBe(false);
    });

    it("returns true (no-op dedupe) when Postgres is disabled (test mode)", async () => {
      mockIsPostgresPersistenceEnabled.mockReturnValue(false);
      mockInMemoryAllowed.mockReturnValue(true);

      const result = await recordEventOnce("evt_x", "any.event", 1700000000, null);

      expect(result).toBe(true);
      expect(mockGetPostgresPool).not.toHaveBeenCalled();
    });
  });

  describe("hasNewerEventForResource", () => {
    it("returns true when a newer event exists for the same resource", async () => {
      mockIsPostgresPersistenceEnabled.mockReturnValue(true);
      const query = jest.fn().mockResolvedValueOnce(queryResult([{ "?column?": 1 }], 1));
      mockGetPostgresPool.mockReturnValue({ query } as unknown as Pool);

      const result = await hasNewerEventForResource("evt_old", "sub_a", 1700000000);

      expect(result).toBe(true);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("event_created > to_timestamp"),
        ["sub_a", "evt_old", 1700000000],
      );
    });

    it("returns false when no newer events exist", async () => {
      mockIsPostgresPersistenceEnabled.mockReturnValue(true);
      const query = jest.fn().mockResolvedValueOnce(queryResult([], 0));
      mockGetPostgresPool.mockReturnValue({ query } as unknown as Pool);

      const result = await hasNewerEventForResource("evt_latest", "sub_a", 1700000100);

      expect(result).toBe(false);
    });

    it("returns false when resourceId is null (event without a resource)", async () => {
      mockIsPostgresPersistenceEnabled.mockReturnValue(true);

      const result = await hasNewerEventForResource("evt_no_resource", null, 1700000000);

      expect(result).toBe(false);
      expect(mockGetPostgresPool).not.toHaveBeenCalled();
    });

    it("returns false when Postgres is disabled (test mode)", async () => {
      mockIsPostgresPersistenceEnabled.mockReturnValue(false);
      mockInMemoryAllowed.mockReturnValue(true);

      const result = await hasNewerEventForResource("evt_x", "sub_a", 1700000000);

      expect(result).toBe(false);
    });
  });
});
