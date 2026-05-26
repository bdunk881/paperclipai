import type { Pool, PoolClient, QueryResult } from "pg";

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

// Mock workspaceContext so we can run the upsert without a real pool.
// withWorkspaceContext invokes the provided fn with a fake client.
const mockWithWorkspaceContext = jest.fn();
jest.mock("../middleware/workspaceContext", () => ({
  withWorkspaceContext: (
    pool: Pool,
    ctx: { workspaceId: string; userId: string },
    fn: (client: PoolClient) => Promise<unknown>,
  ) => mockWithWorkspaceContext(pool, ctx, fn),
}));

import { billingRepository, effectiveEntitlementPlan } from "./billingRepository";

function queryResult<T extends Record<string, unknown>>(
  rows: T[],
  rowCount: number | null = rows.length,
): QueryResult<T> {
  return {
    command: rows.length > 0 ? "SELECT" : "SELECT",
    rowCount,
    oid: 0,
    fields: [],
    rows,
  };
}

// A representative row shape returned by SELECT ... FROM subscriptions
function makeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "sub-uuid-1",
    workspace_id: "ws-1",
    user_id: "user-1",
    email: "test@example.com",
    stripe_subscription_id: "sub_stripe_1",
    stripe_customer_id: "cus_1",
    plan: "flow",
    status: "active",
    access_level: "active",
    current_period_start: new Date("2026-04-01T00:00:00.000Z"),
    current_period_end: new Date("2026-05-01T00:00:00.000Z"),
    cancel_at_period_end: false,
    trial_end: null,
    created_at: new Date("2026-04-01T00:00:00.000Z"),
    updated_at: new Date("2026-04-02T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  mockIsPostgresPersistenceEnabled.mockReset();
  mockInMemoryAllowed.mockReset();
  mockGetPostgresPool.mockReset();
  mockWithWorkspaceContext.mockReset();
});

// ---------------------------------------------------------------------------
// effectiveEntitlementPlan (pure function)
// ---------------------------------------------------------------------------

describe("effectiveEntitlementPlan", () => {
  it("returns the plan unchanged for active status", () => {
    expect(effectiveEntitlementPlan("flow", "active")).toBe("flow");
    expect(effectiveEntitlementPlan("automate", "active")).toBe("automate");
    expect(effectiveEntitlementPlan("scale", "active")).toBe("scale");
  });

  it("returns the plan unchanged for trialing status", () => {
    expect(effectiveEntitlementPlan("flow", "trialing")).toBe("flow");
    expect(effectiveEntitlementPlan("automate", "trialing")).toBe("automate");
  });

  it("downgrades to explore for past_due", () => {
    expect(effectiveEntitlementPlan("flow", "past_due")).toBe("explore");
  });

  it("downgrades to explore for canceled", () => {
    expect(effectiveEntitlementPlan("automate", "canceled")).toBe("explore");
  });

  it("downgrades to explore for unpaid", () => {
    expect(effectiveEntitlementPlan("scale", "unpaid")).toBe("explore");
  });

  it("downgrades to explore for arbitrary unknown status", () => {
    expect(effectiveEntitlementPlan("flow", "something_else")).toBe("explore");
  });
});

// ---------------------------------------------------------------------------
// persistenceAvailable indirectly via repository methods
// ---------------------------------------------------------------------------

describe("persistence guard (via findById)", () => {
  it("returns undefined when persistence is unavailable but in-memory is allowed", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(false);
    mockInMemoryAllowed.mockReturnValue(true);

    const result = await billingRepository.findById("any-id");

    expect(result).toBeUndefined();
    expect(mockGetPostgresPool).not.toHaveBeenCalled();
  });

  it("throws when neither postgres nor in-memory is allowed", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(false);
    mockInMemoryAllowed.mockReturnValue(false);

    await expect(billingRepository.findById("x")).rejects.toThrow(
      /billing persistence requires DATABASE_URL/,
    );
  });
});

// ---------------------------------------------------------------------------
// upsertSubscriptionAndEntitlements
// ---------------------------------------------------------------------------

describe("upsertSubscriptionAndEntitlements", () => {
  it("no-ops when workspaceId is missing", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(true);
    await billingRepository.upsertSubscriptionAndEntitlements({
      workspaceId: undefined,
      stripeSubscriptionId: "sub_x",
      plan: "flow",
      status: "active",
    });
    expect(mockWithWorkspaceContext).not.toHaveBeenCalled();
  });

  it("no-ops when workspaceId is empty / whitespace only", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(true);
    await billingRepository.upsertSubscriptionAndEntitlements({
      workspaceId: "   ",
      stripeSubscriptionId: "sub_x",
      plan: "flow",
      status: "active",
    });
    expect(mockWithWorkspaceContext).not.toHaveBeenCalled();
  });

  it("no-ops when persistence is disabled (in-memory allowed)", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(false);
    mockInMemoryAllowed.mockReturnValue(true);
    await billingRepository.upsertSubscriptionAndEntitlements({
      workspaceId: "ws-1",
      stripeSubscriptionId: "sub_x",
      plan: "flow",
      status: "active",
    });
    expect(mockWithWorkspaceContext).not.toHaveBeenCalled();
  });

  it("throws when persistence required but unavailable (production-like)", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(false);
    mockInMemoryAllowed.mockReturnValue(false);
    await expect(
      billingRepository.upsertSubscriptionAndEntitlements({
        workspaceId: "ws-1",
        stripeSubscriptionId: "sub_x",
        plan: "flow",
        status: "active",
      }),
    ).rejects.toThrow(/billing persistence requires DATABASE_URL/);
  });

  it("performs two queries (subscriptions + entitlements) on the active path", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(true);
    mockGetPostgresPool.mockReturnValue({} as Pool);
    const query = jest
      .fn()
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([]));
    const fakeClient = { query } as unknown as PoolClient;
    mockWithWorkspaceContext.mockImplementation(async (_pool, _ctx, fn) => fn(fakeClient));

    await billingRepository.upsertSubscriptionAndEntitlements({
      workspaceId: "ws-1",
      userId: "user-1",
      email: "u@example.com",
      stripeSubscriptionId: "sub_1",
      stripeCustomerId: "cus_1",
      plan: "automate",
      status: "active",
      accessLevel: "active",
      currentPeriodStart: "2026-04-01T00:00:00Z",
      currentPeriodEnd: "2026-05-01T00:00:00Z",
      cancelAtPeriodEnd: true,
      trialEnd: null,
    });

    expect(mockWithWorkspaceContext).toHaveBeenCalledTimes(1);
    // First call: subscriptions INSERT
    expect(query).toHaveBeenCalledTimes(2);
    const firstSql = query.mock.calls[0][0] as string;
    const firstParams = query.mock.calls[0][1] as unknown[];
    expect(firstSql).toMatch(/INSERT INTO subscriptions/);
    expect(firstParams).toEqual([
      "ws-1",
      "user-1",
      "u@example.com",
      "sub_1",
      "cus_1",
      "automate",
      "active",
      "active",
      "2026-04-01T00:00:00Z",
      "2026-05-01T00:00:00Z",
      true,
      null,
    ]);
    // Second call: entitlements INSERT — limits should reflect "automate"
    const secondSql = query.mock.calls[1][0] as string;
    const secondParams = query.mock.calls[1][1] as unknown[];
    expect(secondSql).toMatch(/INSERT INTO entitlements/);
    // automate limits: runsPerMonth=1000, agentCap=10, integrationCap=10,
    // byokAllowed=true, logRetentionDays=90, approvalTierMax=2, plan="automate"
    expect(secondParams).toEqual([
      "ws-1",
      1000,
      10,
      10,
      true,
      90,
      2,
      "automate",
    ]);
  });

  it("trims workspaceId, defaults userId to 'stripe-webhook' in withWorkspaceContext context, and downgrades plan when status is not active", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(true);
    mockGetPostgresPool.mockReturnValue({} as Pool);
    const query = jest
      .fn()
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([]));
    const fakeClient = { query } as unknown as PoolClient;
    mockWithWorkspaceContext.mockImplementation(async (_pool, _ctx, fn) => fn(fakeClient));

    await billingRepository.upsertSubscriptionAndEntitlements({
      workspaceId: "  ws-2  ",
      // No userId provided -> default to "stripe-webhook"
      stripeSubscriptionId: "sub_2",
      plan: "scale",
      status: "past_due", // non-active -> entitlement plan becomes explore
      // No defaults for several fields — exercise null/false branches
    });

    expect(mockWithWorkspaceContext).toHaveBeenCalledTimes(1);
    const ctx = mockWithWorkspaceContext.mock.calls[0][1] as {
      workspaceId: string;
      userId: string;
    };
    expect(ctx.workspaceId).toBe("ws-2");
    expect(ctx.userId).toBe("stripe-webhook");

    // subscriptions params: missing optional fields collapse to null/false.
    // Note: input.userId is undefined, so the SQL param is null even though
    // the workspace-context userId is "stripe-webhook".
    const subParams = query.mock.calls[0][1] as unknown[];
    expect(subParams).toEqual([
      "ws-2",
      null, // userId
      null, // email
      "sub_2",
      null, // stripeCustomerId
      "scale",
      "past_due",
      null, // accessLevel
      null, // currentPeriodStart
      null, // currentPeriodEnd
      false, // cancelAtPeriodEnd default
      null, // trialEnd
    ]);

    // entitlements: explore limits because status != active|trialing
    const entitlementParams = query.mock.calls[1][1] as unknown[];
    expect(entitlementParams[0]).toBe("ws-2");
    expect(entitlementParams[7]).toBe("explore"); // entitlementPlan
    // explore: runs=25, agentCap=1, integrationCap=1, byok=true,
    // logRetentionDays=14, approvalTierMax=0
    expect(entitlementParams[1]).toBe(25);
    expect(entitlementParams[2]).toBe(1);
    expect(entitlementParams[3]).toBe(1);
    expect(entitlementParams[4]).toBe(true);
    expect(entitlementParams[5]).toBe(14);
    expect(entitlementParams[6]).toBe(0);
  });

  it("uses the trimmed input.userId for the workspace-context userId when provided", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(true);
    mockGetPostgresPool.mockReturnValue({} as Pool);
    const query = jest
      .fn()
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([]));
    const fakeClient = { query } as unknown as PoolClient;
    mockWithWorkspaceContext.mockImplementation(async (_pool, _ctx, fn) => fn(fakeClient));

    await billingRepository.upsertSubscriptionAndEntitlements({
      workspaceId: "ws-3",
      userId: "  real-user  ",
      stripeSubscriptionId: "sub_3",
      plan: "flow",
      status: "trialing",
    });

    const ctx = mockWithWorkspaceContext.mock.calls[0][1] as {
      workspaceId: string;
      userId: string;
    };
    expect(ctx.userId).toBe("real-user");
  });

  it("uses 'stripe-webhook' fallback when input.userId is whitespace-only", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(true);
    mockGetPostgresPool.mockReturnValue({} as Pool);
    const query = jest
      .fn()
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([]));
    const fakeClient = { query } as unknown as PoolClient;
    mockWithWorkspaceContext.mockImplementation(async (_pool, _ctx, fn) => fn(fakeClient));

    await billingRepository.upsertSubscriptionAndEntitlements({
      workspaceId: "ws-4",
      userId: "   ",
      stripeSubscriptionId: "sub_4",
      plan: "flow",
      status: "active",
    });

    const ctx = mockWithWorkspaceContext.mock.calls[0][1] as {
      workspaceId: string;
      userId: string;
    };
    expect(ctx.userId).toBe("stripe-webhook");
  });
});

// ---------------------------------------------------------------------------
// loadAllSubscriptions
// ---------------------------------------------------------------------------

describe("loadAllSubscriptions", () => {
  it("returns [] when persistence is unavailable", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(false);
    mockInMemoryAllowed.mockReturnValue(true);
    const result = await billingRepository.loadAllSubscriptions();
    expect(result).toEqual([]);
    expect(mockGetPostgresPool).not.toHaveBeenCalled();
  });

  it("maps rows to Subscription objects with sensible defaults for nullable columns", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(true);
    const fullRow = makeRow();
    const sparseRow = makeRow({
      id: "sub-uuid-2",
      workspace_id: null,
      user_id: null,
      email: null,
      stripe_customer_id: null,
      access_level: null,
      current_period_start: null,
      current_period_end: null,
      trial_end: null,
    });
    const query = jest.fn().mockResolvedValueOnce(queryResult([fullRow, sparseRow]));
    mockGetPostgresPool.mockReturnValue({ query } as unknown as Pool);

    const subs = await billingRepository.loadAllSubscriptions();

    expect(subs).toHaveLength(2);

    // First row — full data
    expect(subs[0]).toEqual({
      id: "sub-uuid-1",
      workspaceId: "ws-1",
      stripeSubscriptionId: "sub_stripe_1",
      stripeCustomerId: "cus_1",
      userId: "user-1",
      email: "test@example.com",
      tier: "flow",
      accessLevel: "active",
      status: "active",
      currentPeriodStart: "2026-04-01T00:00:00.000Z",
      currentPeriodEnd: "2026-05-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      trialEnd: null,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
    });

    // Second row — nullable defaults
    expect(subs[1]).toEqual({
      id: "sub-uuid-2",
      workspaceId: undefined,
      stripeSubscriptionId: "sub_stripe_1",
      stripeCustomerId: "",
      userId: "",
      email: "",
      tier: "flow",
      accessLevel: "none",
      status: "active",
      currentPeriodStart: "",
      currentPeriodEnd: "",
      cancelAtPeriodEnd: false,
      trialEnd: null,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
    });
  });

  it("returns an empty array when no rows exist", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(true);
    const query = jest.fn().mockResolvedValueOnce(queryResult([]));
    mockGetPostgresPool.mockReturnValue({ query } as unknown as Pool);
    const subs = await billingRepository.loadAllSubscriptions();
    expect(subs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe("findById", () => {
  it("returns undefined when persistence is unavailable", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(false);
    mockInMemoryAllowed.mockReturnValue(true);
    expect(await billingRepository.findById("x")).toBeUndefined();
  });

  it("returns mapped row when found", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(true);
    const query = jest.fn().mockResolvedValueOnce(queryResult([makeRow({ id: "sub-X" })]));
    mockGetPostgresPool.mockReturnValue({ query } as unknown as Pool);

    const sub = await billingRepository.findById("sub-X");

    expect(sub?.id).toBe("sub-X");
    expect(sub?.tier).toBe("flow");
    expect(query).toHaveBeenCalledWith(expect.stringMatching(/WHERE id = \$1/), ["sub-X"]);
  });

  it("returns undefined when not found", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(true);
    const query = jest.fn().mockResolvedValueOnce(queryResult([]));
    mockGetPostgresPool.mockReturnValue({ query } as unknown as Pool);
    expect(await billingRepository.findById("missing")).toBeUndefined();
  });

  it("maps a row with all-null optional columns to defaults", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(true);
    const sparseRow = makeRow({
      workspace_id: null,
      user_id: null,
      email: null,
      stripe_customer_id: null,
      access_level: null,
      current_period_start: null,
      current_period_end: null,
      trial_end: null,
    });
    const query = jest.fn().mockResolvedValueOnce(queryResult([sparseRow]));
    mockGetPostgresPool.mockReturnValue({ query } as unknown as Pool);

    const sub = await billingRepository.findById("sub-uuid-1");

    expect(sub?.workspaceId).toBeUndefined();
    expect(sub?.userId).toBe("");
    expect(sub?.email).toBe("");
    expect(sub?.stripeCustomerId).toBe("");
    expect(sub?.accessLevel).toBe("none");
    expect(sub?.currentPeriodStart).toBe("");
    expect(sub?.currentPeriodEnd).toBe("");
    expect(sub?.trialEnd).toBeNull();
  });

  it("maps a row with trial_end populated to an ISO string", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(true);
    const rowWithTrial = makeRow({
      trial_end: new Date("2026-06-15T12:00:00.000Z"),
    });
    const query = jest.fn().mockResolvedValueOnce(queryResult([rowWithTrial]));
    mockGetPostgresPool.mockReturnValue({ query } as unknown as Pool);
    const sub = await billingRepository.findById("sub-uuid-1");
    expect(sub?.trialEnd).toBe("2026-06-15T12:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// findByStripeSubscriptionId
// ---------------------------------------------------------------------------

describe("findByStripeSubscriptionId", () => {
  it("returns undefined when persistence is unavailable", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(false);
    mockInMemoryAllowed.mockReturnValue(true);
    expect(await billingRepository.findByStripeSubscriptionId("sub_x")).toBeUndefined();
  });

  it("returns mapped row when found", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(true);
    const query = jest
      .fn()
      .mockResolvedValueOnce(queryResult([makeRow({ stripe_subscription_id: "sub_abc" })]));
    mockGetPostgresPool.mockReturnValue({ query } as unknown as Pool);

    const sub = await billingRepository.findByStripeSubscriptionId("sub_abc");

    expect(sub?.stripeSubscriptionId).toBe("sub_abc");
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/WHERE stripe_subscription_id = \$1/),
      ["sub_abc"],
    );
  });

  it("returns undefined when not found", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(true);
    const query = jest.fn().mockResolvedValueOnce(queryResult([]));
    mockGetPostgresPool.mockReturnValue({ query } as unknown as Pool);
    expect(await billingRepository.findByStripeSubscriptionId("sub_missing")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findByUserId
// ---------------------------------------------------------------------------

describe("findByUserId", () => {
  it("returns undefined when persistence is unavailable", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(false);
    mockInMemoryAllowed.mockReturnValue(true);
    expect(await billingRepository.findByUserId("u")).toBeUndefined();
  });

  it("returns mapped row when found and orders by updated_at DESC", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(true);
    const query = jest
      .fn()
      .mockResolvedValueOnce(queryResult([makeRow({ user_id: "user-9" })]));
    mockGetPostgresPool.mockReturnValue({ query } as unknown as Pool);

    const sub = await billingRepository.findByUserId("user-9");

    expect(sub?.userId).toBe("user-9");
    const sql = (query.mock.calls[0][0] as string).replace(/\s+/g, " ");
    expect(sql).toMatch(/WHERE user_id = \$1/);
    expect(sql).toMatch(/ORDER BY updated_at DESC/);
    expect(sql).toMatch(/LIMIT 1/);
    expect(query.mock.calls[0][1]).toEqual(["user-9"]);
  });

  it("returns undefined when no rows exist", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(true);
    const query = jest.fn().mockResolvedValueOnce(queryResult([]));
    mockGetPostgresPool.mockReturnValue({ query } as unknown as Pool);
    expect(await billingRepository.findByUserId("none")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findByStripeCustomerId
// ---------------------------------------------------------------------------

describe("findByStripeCustomerId", () => {
  it("returns [] when persistence is unavailable", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(false);
    mockInMemoryAllowed.mockReturnValue(true);
    expect(await billingRepository.findByStripeCustomerId("cus_x")).toEqual([]);
  });

  it("returns all mapped rows for the given customer", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(true);
    const query = jest.fn().mockResolvedValueOnce(
      queryResult([
        makeRow({ id: "sub-a", stripe_customer_id: "cus_multi" }),
        makeRow({ id: "sub-b", stripe_customer_id: "cus_multi" }),
      ]),
    );
    mockGetPostgresPool.mockReturnValue({ query } as unknown as Pool);

    const subs = await billingRepository.findByStripeCustomerId("cus_multi");

    expect(subs).toHaveLength(2);
    expect(subs[0].id).toBe("sub-a");
    expect(subs[1].id).toBe("sub-b");
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/WHERE stripe_customer_id = \$1/),
      ["cus_multi"],
    );
  });

  it("returns an empty array when no rows match", async () => {
    mockIsPostgresPersistenceEnabled.mockReturnValue(true);
    const query = jest.fn().mockResolvedValueOnce(queryResult([]));
    mockGetPostgresPool.mockReturnValue({ query } as unknown as Pool);
    expect(await billingRepository.findByStripeCustomerId("cus_none")).toEqual([]);
  });
});
