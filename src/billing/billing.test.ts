// Prevent transitive import of ESM-only @mistralai/mistralai package
jest.mock("../engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));

jest.mock("./stripeClient", () => ({
  getStripe: jest.fn(),
  PRICING_TIERS: {
    explore: { name: "Explore", price: 0, priceId: null, trialDays: 0 },
    flow: { name: "Flow", price: 19, priceId: "price_flow_test", trialDays: 14 },
    automate: { name: "Automate", price: 49, priceId: "price_automate_test", trialDays: 14 },
    scale: { name: "Scale", price: 99, priceId: "price_scale_test", trialDays: 0 },
  },
}));
jest.mock("../auth/authMiddleware", () => ({
  requireAuth: (req: { headers: { authorization?: string }; auth?: { sub: string } }, res: { status: (code: number) => { json: (body: unknown) => void } }, next: () => void) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or malformed Authorization header." });
      return;
    }
    req.auth = { sub: auth.slice(7) };
    next();
  },
}));

import request from "supertest";
import app from "../app";
import { subscriptionStore } from "./subscriptionStore";
import { mapStripeStatusToAccess, resolveTier } from "./subscriptionStore";
import { getStripe } from "./stripeClient";

function asAuth(userId: string) {
  return { Authorization: `Bearer ${userId}` };
}

function makeStripeMock() {
  return {
    checkout: {
      sessions: {
        create: jest.fn(),
      },
    },
    subscriptions: {
      retrieve: jest.fn(),
      update: jest.fn(),
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
  };
}

let stripeMock = makeStripeMock();

const baseSubscription = {
  id: "sub-store-1",
  stripeSubscriptionId: "sub_stripe_store_1",
  stripeCustomerId: "cus_store_1",
  userId: "user-store-1",
  email: "store@example.com",
  tier: "flow" as const,
  accessLevel: "active" as const,
  status: "active",
  currentPeriodStart: "2026-04-01T00:00:00.000Z",
  currentPeriodEnd: "2026-05-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  trialEnd: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
};

beforeEach(() => {
  stripeMock = makeStripeMock();
  (getStripe as jest.Mock).mockReturnValue(stripeMock);
  subscriptionStore.clear();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});

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
  const savedEnv = {
    STRIPE_FLOW_PRICE_ID: process.env.STRIPE_FLOW_PRICE_ID,
    STRIPE_AUTOMATE_PRICE_ID: process.env.STRIPE_AUTOMATE_PRICE_ID,
    STRIPE_SCALE_PRICE_ID: process.env.STRIPE_SCALE_PRICE_ID,
    STRIPE_PRICE_STARTER: process.env.STRIPE_PRICE_STARTER,
    STRIPE_PRICE_PROFESSIONAL: process.env.STRIPE_PRICE_PROFESSIONAL,
    STRIPE_PRICE_ENTERPRISE: process.env.STRIPE_PRICE_ENTERPRISE,
  };

  afterEach(() => {
    process.env.STRIPE_FLOW_PRICE_ID = savedEnv.STRIPE_FLOW_PRICE_ID;
    process.env.STRIPE_AUTOMATE_PRICE_ID = savedEnv.STRIPE_AUTOMATE_PRICE_ID;
    process.env.STRIPE_SCALE_PRICE_ID = savedEnv.STRIPE_SCALE_PRICE_ID;
    process.env.STRIPE_PRICE_STARTER = savedEnv.STRIPE_PRICE_STARTER;
    process.env.STRIPE_PRICE_PROFESSIONAL = savedEnv.STRIPE_PRICE_PROFESSIONAL;
    process.env.STRIPE_PRICE_ENTERPRISE = savedEnv.STRIPE_PRICE_ENTERPRISE;
  });

  it("resolves from metadata", () => {
    expect(resolveTier({ tier: "automate" })).toBe("automate");
  });

  it("defaults to explore", () => {
    expect(resolveTier({})).toBe("explore");
  });

  it("defaults to explore for unknown tier", () => {
    expect(resolveTier({ tier: "enterprise" })).toBe("explore");
  });

  it("resolves by canonical stripe price env vars", () => {
    process.env.STRIPE_FLOW_PRICE_ID = "price_flow_env";
    process.env.STRIPE_AUTOMATE_PRICE_ID = "price_automate_env";
    process.env.STRIPE_SCALE_PRICE_ID = "price_scale_env";

    expect(resolveTier(undefined, "price_flow_env")).toBe("flow");
    expect(resolveTier(undefined, "price_automate_env")).toBe("automate");
    expect(resolveTier(undefined, "price_scale_env")).toBe("scale");
  });

  it("resolves by starter/professional/enterprise alias env vars", () => {
    process.env.STRIPE_FLOW_PRICE_ID = "";
    process.env.STRIPE_AUTOMATE_PRICE_ID = "";
    process.env.STRIPE_SCALE_PRICE_ID = "";
    process.env.STRIPE_PRICE_STARTER = "price_starter_alias";
    process.env.STRIPE_PRICE_PROFESSIONAL = "price_professional_alias";
    process.env.STRIPE_PRICE_ENTERPRISE = "price_enterprise_alias";

    expect(resolveTier(undefined, "price_starter_alias")).toBe("flow");
    expect(resolveTier(undefined, "price_professional_alias")).toBe("automate");
    expect(resolveTier(undefined, "price_enterprise_alias")).toBe("scale");
  });
});

// ---------------------------------------------------------------------------
// Integration tests — API endpoints
// ---------------------------------------------------------------------------

describe("POST /api/billing/checkout", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).post("/api/billing/checkout").send({ tier: "flow" });

    expect(res.status).toBe(401);
  });

  it("rejects missing tier", async () => {
    const res = await request(app).post("/api/billing/checkout").set(asAuth("user-123")).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid tier/);
  });

  it("rejects invalid tier", async () => {
    const res = await request(app).post("/api/billing/checkout").set(asAuth("user-123")).send({ tier: "enterprise" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid tier/);
  });

  it("creates a checkout session for paid tiers", async () => {
    stripeMock.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.test/session_123",
    });

    const res = await request(app).post("/api/billing/checkout").set(asAuth("user-123")).send({
      tier: "flow",
      email: "buyer@example.com",
      firstName: "Ada",
      companyName: "AutoFlow",
      userId: "user-123",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: "https://checkout.stripe.test/session_123" });
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer_email: "buyer@example.com",
        line_items: [{ price: "price_flow_test", quantity: 1 }],
        subscription_data: { trial_period_days: 14 },
        metadata: {
          tier: "flow",
          email: "buyer@example.com",
          firstName: "Ada",
          companyName: "AutoFlow",
          userId: "user-123",
        },
      })
    );
  });
});

describe("GET /api/billing/subscription", () => {
  beforeEach(() => subscriptionStore.clear());

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/api/billing/subscription");
    expect(res.status).toBe(401);
  });

  it("returns null subscription for unknown user", async () => {
    const res = await request(app).get("/api/billing/subscription").set(asAuth("unknown"));
    expect(res.status).toBe(200);
    expect(res.body.subscription).toBeNull();
    expect(res.body.accessLevel).toBe("none");
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

    const res = await request(app).get("/api/billing/subscription").set(asAuth("user-test"));
    expect(res.status).toBe(200);
    expect(res.body.subscription.tier).toBe("automate");
    expect(res.body.accessLevel).toBe("active");
  });
});

describe("POST /api/billing/subscription/cancel", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).post("/api/billing/subscription/cancel").send({});
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown user", async () => {
    const res = await request(app).post("/api/billing/subscription/cancel").set(asAuth("nope")).send({});
    expect(res.status).toBe(404);
  });

  it("schedules cancellation at period end", async () => {
    subscriptionStore.upsert({ ...baseSubscription, userId: "cancel-user", id: "sub-cancel" });
    stripeMock.subscriptions.update.mockResolvedValue({ status: "active" });

    const res = await request(app).post("/api/billing/subscription/cancel").set(asAuth("cancel-user")).send({});
    const updated = subscriptionStore.get("sub-cancel");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      cancelAtPeriodEnd: true,
      accessUntil: "2026-05-01T00:00:00.000Z",
    });
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith("sub_stripe_store_1", {
      cancel_at_period_end: true,
    });
    expect(updated?.cancelAtPeriodEnd).toBe(true);
  });
});

describe("POST /api/billing/subscription/change-tier", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).post("/api/billing/subscription/change-tier").send({ newTier: "automate" });
    expect(res.status).toBe(401);
  });

  it("rejects invalid tier", async () => {
    const res = await request(app).post("/api/billing/subscription/change-tier").set(asAuth("u1")).send({ newTier: "enterprise" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown user", async () => {
    const res = await request(app).post("/api/billing/subscription/change-tier").set(asAuth("nope")).send({ newTier: "automate" });
    expect(res.status).toBe(404);
  });

  it("changes tier and updates stripe subscription", async () => {
    subscriptionStore.upsert({ ...baseSubscription, userId: "upgrade-user", id: "sub-upgrade" });
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: "si_123" }] },
      metadata: { userId: "upgrade-user" },
    });
    stripeMock.subscriptions.update.mockResolvedValue({ status: "active" });

    const res = await request(app)
      .post("/api/billing/subscription/change-tier")
      .set(asAuth("upgrade-user"))
      .send({ newTier: "automate" });
    const updated = subscriptionStore.get("sub-upgrade");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      previousTier: "flow",
      newTier: "automate",
      proration: "immediate",
    });
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith("sub_stripe_store_1", {
      items: [{ id: "si_123", price: "price_automate_test" }],
      proration_behavior: "create_prorations",
      metadata: { userId: "upgrade-user", tier: "automate" },
    });
    expect(updated?.tier).toBe("automate");
  });
});

describe("POST /api/billing/subscription/reactivate", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).post("/api/billing/subscription/reactivate").send({});
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown user", async () => {
    const res = await request(app).post("/api/billing/subscription/reactivate").set(asAuth("nope")).send({});
    expect(res.status).toBe(404);
  });

  it("reactivates a scheduled cancellation", async () => {
    subscriptionStore.upsert({
      ...baseSubscription,
      id: "sub-reactivate",
      userId: "reactivate-user",
      cancelAtPeriodEnd: true,
    });
    stripeMock.subscriptions.update.mockResolvedValue({ status: "active" });

    const res = await request(app).post("/api/billing/subscription/reactivate").set(asAuth("reactivate-user")).send({});
    const updated = subscriptionStore.get("sub-reactivate");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, cancelAtPeriodEnd: false });
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith("sub_stripe_store_1", {
      cancel_at_period_end: false,
    });
    expect(updated?.cancelAtPeriodEnd).toBe(false);
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

  it("handles checkout.session.completed and provisions subscription", async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          metadata: { tier: "automate", userId: "webhook-user", email: "webhook@example.com" },
          customer: "cus_webhook",
          subscription: "sub_webhook_1",
        },
      },
    });
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      status: "active",
      cancel_at_period_end: false,
      trial_end: null,
      items: {
        data: [
          {
            price: { id: "price_automate_test" },
            current_period_start: 1711929600,
            current_period_end: 1714521600,
          },
        ],
      },
    });

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("stripe-signature", "sig_test")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ id: "evt_1" }));

    const sub = subscriptionStore.getByStripeSubscriptionId("sub_webhook_1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(sub?.userId).toBe("webhook-user");
    expect(sub?.tier).toBe("automate");
    expect(sub?.accessLevel).toBe("active");
  });

  it("handles invoice.paid and refreshes period dates", async () => {
    subscriptionStore.upsert({
      ...baseSubscription,
      id: "sub-invoice-paid",
      stripeSubscriptionId: "sub_invoice_paid",
      userId: "invoice-user",
      currentPeriodStart: "2026-01-01T00:00:00.000Z",
      currentPeriodEnd: "2026-02-01T00:00:00.000Z",
    });
    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: "invoice.paid",
      data: {
        object: {
          parent: {
            subscription_details: {
              subscription: "sub_invoice_paid",
            },
          },
        },
      },
    });
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      status: "active",
      cancel_at_period_end: false,
      items: {
        data: [
          {
            current_period_start: 1714521600,
            current_period_end: 1717113600,
          },
        ],
      },
    });

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("stripe-signature", "sig_test")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ id: "evt_2" }));

    const updated = subscriptionStore.get("sub-invoice-paid");
    expect(res.status).toBe(200);
    expect(updated?.currentPeriodStart).toBe("2024-05-01T00:00:00.000Z");
    expect(updated?.currentPeriodEnd).toBe("2024-05-31T00:00:00.000Z");
    expect(updated?.accessLevel).toBe("active");
  });

  it("handles invoice.payment_failed and marks subscription as past_due", async () => {
    subscriptionStore.upsert({
      ...baseSubscription,
      id: "sub-payment-failed",
      stripeSubscriptionId: "sub_payment_failed",
      userId: "failed-user",
    });
    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: "invoice.payment_failed",
      data: {
        object: {
          attempt_count: 2,
          parent: {
            subscription_details: {
              subscription: "sub_payment_failed",
            },
          },
        },
      },
    });

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("stripe-signature", "sig_test")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ id: "evt_3" }));

    const updated = subscriptionStore.get("sub-payment-failed");
    expect(res.status).toBe(200);
    expect(updated?.status).toBe("past_due");
    expect(updated?.accessLevel).toBe("past_due");
  });

  it("handles customer.subscription.deleted and revokes access", async () => {
    subscriptionStore.upsert({
      ...baseSubscription,
      id: "sub-deleted",
      stripeSubscriptionId: "sub_deleted",
      userId: "deleted-user",
      cancelAtPeriodEnd: true,
    });
    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_deleted",
        },
      },
    });

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("stripe-signature", "sig_test")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ id: "evt_4" }));

    const updated = subscriptionStore.get("sub-deleted");
    expect(res.status).toBe(200);
    expect(updated?.status).toBe("canceled");
    expect(updated?.accessLevel).toBe("cancelled");
    expect(updated?.cancelAtPeriodEnd).toBe(false);
  });
});
