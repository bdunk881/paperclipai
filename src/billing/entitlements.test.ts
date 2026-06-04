/**
 * HEL-473 / B13 — entitlement read-cache TTL (cross-instance plan propagation).
 */

const mockQuery = jest.fn();
jest.mock("../db/postgres", () => ({
  getPostgresPool: () => ({ query: mockQuery }),
  isPostgresPersistenceEnabled: jest.fn(() => true),
  inMemoryAllowed: jest.fn(() => false),
}));

import { entitlementStore } from "./entitlements";

function scaleRow(workspaceId: string) {
  return {
    workspace_id: workspaceId,
    runs_per_month: 9999,
    agent_cap: 99,
    integration_cap: 99,
    byok_allowed: true,
    log_retention_days: 365,
    approval_tier_max: 9,
    plan: "scale",
    updated_at: new Date("2026-06-01T00:00:00Z"),
  };
}

describe("entitlementStore cache TTL (B13/HEL-473)", () => {
  beforeEach(() => {
    entitlementStore.clear();
    mockQuery.mockReset();
    jest.restoreAllMocks();
  });

  it("serves a fresh cached entry without hitting Postgres", async () => {
    jest.spyOn(Date, "now").mockReturnValue(2_000_000);
    entitlementStore.upsert("ws-fresh", "scale");

    const got = await entitlementStore.get("ws-fresh");
    expect(got?.plan).toBe("scale");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("re-reads Postgres once a cached entry goes stale, so a plan change on another instance propagates", async () => {
    const t0 = 1_000_000;
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(t0);

    // Instance B cached the old 'explore' tier.
    entitlementStore.upsert("ws-1", "explore");
    expect((await entitlementStore.get("ws-1"))?.plan).toBe("explore");
    expect(mockQuery).not.toHaveBeenCalled();

    // >30s later, Postgres reflects an upgrade made on another instance.
    nowSpy.mockReturnValue(t0 + 31_000);
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [scaleRow("ws-1")] });

    const refreshed = await entitlementStore.get("ws-1");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(refreshed?.plan).toBe("scale");
  });

  it("drops a stale cache entry when the Postgres row is gone", async () => {
    const t0 = 5_000_000;
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(t0);
    entitlementStore.upsert("ws-gone", "scale");

    nowSpy.mockReturnValue(t0 + 31_000);
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });

    expect(await entitlementStore.get("ws-gone")).toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
