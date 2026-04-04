// Prevent transitive import of ESM-only @mistralai/mistralai package
jest.mock("../engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));

import request from "supertest";
import app from "../app";
import { subscriptionStore } from "./subscriptionStore";
import { mapStripeStatusToAccess, resolveTier } from "./subscriptionStore";

// ---------------------------------------------------------------------------
// Unit tests — subscriptionStore
// ---------------------------------------------------------------------------

describe("subscriptionStore", () => {
  beforeEach(() => subscriptionStore.clear());

  const baseSub = {
    id: "sub-1",
    stripeSubscriptionId: "sub_stripe_1",
    stripeCustomerId: "cus_1",
    userId: "user-1",
    email: "test@example.com",
    tier: "flow" as const,
    accessLevel: "active" as const,
    status: "active",
    currentPeriodStart: "2026-04-01T00:00:00Z",
    currentPeriodEnd: "2026-05-01T00:00:00Z",
    cancelAtPeriodEnd: false,
    trialEnd: null,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
  };

  it("upsert and get by id", () => {
    subscriptionStore.upsert(baseSub);
    expect(subscriptionStore.get("sub-1")).toEqual(baseSub);
  });

  it("get by stripe subscription id", () => {
    subscriptionStore.upsert(baseSub);
    expect(subscriptionStore.getByStripeSubscriptionId("sub_stripe_1")?.id).toBe("sub-1");
  });

  it("get by user id", () => {
    subscriptionStore.upsert(baseSub);
    expect(subscriptionStore.getByUserId("user-1")?.id).toBe("sub-1");
  });

  it("get by stripe customer id", () => {
    subscriptionStore.upsert(baseSub);
    const subs = subscriptionStore.getByStripeCustomerId("cus_1");
    expect(subs).toHaveLength(1);
    expect(subs[0].id).toBe("sub-1");
  });

  it("update", () => {
    subscriptionStore.upsert(baseSub);
    subscriptionStore.update("sub-1", { tier: "automate" });
    expect(subscriptionStore.get("sub-1")?.tier).toBe("automate");
  });

  it("list returns all", () => {
    subscriptionStore.upsert(baseSub);
    subscriptionStore.upsert({ ...baseSub, id: "sub-2", stripeSubscriptionId: "sub_stripe_2", userId: "user-2" });
    expect(subscriptionStore.list()).toHaveLength(2);
  });

  it("returns undefined for missing ids", () => {
    expect(subscriptionStore.get("nonexistent")).toBeUndefined();
    expect(subscriptionStore.getByStripeSubscriptionId("nope")).toBeUndefined();
    expect(subscriptionStore.getByUserId("nope")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Unit tests — mapStripeStatusToAccess
// ---------------------------------------------------------------------------

describe("mapStripeStatusToAccess", () => {
  it("maps trialing to trial", () => {
    expect(mapStripeStatusToAccess("trialing", false)).toBe("trial");
  });

  it("maps active to active", () => {
    expect(mapStripeStatusToAccess("active", false)).toBe("active");
  });

  it("maps active with cancelAtPeriodEnd to active", () => {
    expect(mapStripeStatusToAccess("active", true)).toBe("active");
  });

  it("maps past_due", () => {
    expect(mapStripeStatusToAccess("past_due", false)).toBe("past_due");
  });

  it("maps canceled to cancelled", () => {
    expect(mapStripeStatusToAccess("canceled", false)).toBe("cancelled");
  });

  it("maps unpaid to cancelled", () => {
    expect(mapStripeStatusToAccess("unpaid", false)).toBe("cancelled");
  });

  it("maps unknown to none", () => {
    expect(mapStripeStatusToAccess("something_else", false)).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Unit tests — resolveTier
// ---------------------------------------------------------------------------

describe("resolveTier", () => {
  it("resolves from metadata", () => {
    expect(resolveTier({ tier: "automate" })).toBe("automate");
  });

  it("defaults to explore", () => {
    expect(resolveTier({})).toBe("explore");
  });

  it("defaults to explore for unknown tier", () => {
    expect(resolveTier({ tier: "enterprise" })).toBe("explore");
  });
});

// ---------------------------------------------------------------------------
// Integration tests — API endpoints
// ---------------------------------------------------------------------------

describe("POST /api/billing/checkout", () => {
  it("rejects missing tier", async () => {
    const res = await request(app).post("/api/billing/checkout").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid tier/);
  });

  it("rejects invalid tier", async () => {
    const res = await request(app).post("/api/billing/checkout").send({ tier: "enterprise" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid tier/);
  });
});

describe("GET /api/billing/subscription", () => {
  beforeEach(() => subscriptionStore.clear());

  it("returns null subscription for unknown user", async () => {
    const res = await request(app).get("/api/billing/subscription?userId=unknown");
    expect(res.status).toBe(200);
    expect(res.body.subscription).toBeNull();
    expect(res.body.accessLevel).toBe("none");
  });

  it("requires userId", async () => {
    const res = await request(app).get("/api/billing/subscription");
    expect(res.status).toBe(400);
  });

  it("returns subscription for known user", async () => {
    subscriptionStore.upsert({
      id: "sub-test",
      stripeSubscriptionId: "sub_stripe_test",
      stripeCustomerId: "cus_test",
      userId: "user-test",
      email: "test@example.com",
      tier: "automate",
      accessLevel: "active",
      status: "active",
      currentPeriodStart: "2026-04-01T00:00:00Z",
      currentPeriodEnd: "2026-05-01T00:00:00Z",
      cancelAtPeriodEnd: false,
      trialEnd: null,
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-01T00:00:00Z",
    });

    const res = await request(app).get("/api/billing/subscription?userId=user-test");
    expect(res.status).toBe(200);
    expect(res.body.subscription.tier).toBe("automate");
    expect(res.body.accessLevel).toBe("active");
  });
});

describe("POST /api/billing/subscription/cancel", () => {
  it("rejects missing userId", async () => {
    const res = await request(app).post("/api/billing/subscription/cancel").send({});
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown user", async () => {
    const res = await request(app).post("/api/billing/subscription/cancel").send({ userId: "nope" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/billing/subscription/change-tier", () => {
  it("rejects missing userId", async () => {
    const res = await request(app).post("/api/billing/subscription/change-tier").send({ newTier: "automate" });
    expect(res.status).toBe(400);
  });

  it("rejects invalid tier", async () => {
    const res = await request(app).post("/api/billing/subscription/change-tier").send({ userId: "u1", newTier: "enterprise" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown user", async () => {
    const res = await request(app).post("/api/billing/subscription/change-tier").send({ userId: "nope", newTier: "automate" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/billing/subscription/reactivate", () => {
  it("rejects missing userId", async () => {
    const res = await request(app).post("/api/billing/subscription/reactivate").send({});
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown user", async () => {
    const res = await request(app).post("/api/billing/subscription/reactivate").send({ userId: "nope" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/webhooks/stripe", () => {
  it("rejects requests without stripe-signature header", async () => {
    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ type: "test" }));
    // Without STRIPE_WEBHOOK_SECRET set, returns 503
    // With it set but no sig, returns 400
    expect([400, 503]).toContain(res.status);
  });
});
