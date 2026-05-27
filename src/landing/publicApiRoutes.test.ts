jest.mock("../engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));

const PRICE_ID_BY_ENV: Record<string, string> = {
  STRIPE_FLOW_PRICE_ID: "price_flow_test",
  STRIPE_AUTOMATE_PRICE_ID: "price_automate_test",
  STRIPE_SCALE_PRICE_ID: "price_scale_test",
};

jest.mock("../billing/stripeClient", () => ({
  getStripe: jest.fn(),
  resolveStripePriceId: jest.fn((envName: string | null) =>
    envName ? (PRICE_ID_BY_ENV[envName] ?? "") : ""
  ),
}));

jest.mock("../billing/tiersRepository", () => {
  const tiers: Record<string, unknown> = {
    explore: {
      id: "explore", displayName: "Explore", priceUsdCents: 0, currency: "usd",
      stripePriceEnv: null, trialDays: 0, sortOrder: 10, isPopular: false,
      features: [], ctaLabel: "Get started", enabled: true,
    },
    flow: {
      id: "flow", displayName: "Flow", priceUsdCents: 1900, currency: "usd",
      stripePriceEnv: "STRIPE_FLOW_PRICE_ID", trialDays: 14, sortOrder: 20,
      isPopular: false, features: [], ctaLabel: "Start trial", enabled: true,
    },
    automate: {
      id: "automate", displayName: "Automate", priceUsdCents: 4900, currency: "usd",
      stripePriceEnv: "STRIPE_AUTOMATE_PRICE_ID", trialDays: 14, sortOrder: 30,
      isPopular: true, features: [], ctaLabel: "Start trial", enabled: true,
    },
    scale: {
      id: "scale", displayName: "Scale", priceUsdCents: 9900, currency: "usd",
      stripePriceEnv: "STRIPE_SCALE_PRICE_ID", trialDays: 0, sortOrder: 40,
      isPopular: false, features: [], ctaLabel: "Talk to sales", enabled: true,
    },
  };
  return {
    getTierById: jest.fn(async (id: string) => tiers[id] ?? null),
    listEnabledTiers: jest.fn(async () => Object.values(tiers)),
  };
});

jest.mock("../billing/credits/packCatalog", () => ({
  listEnabledPacks: jest.fn(),
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
  requireAuthOrQaBypass: (req: { headers: { authorization?: string }; auth?: { sub: string } }, res: { status: (code: number) => { json: (body: unknown) => void } }, next: () => void) => {
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
import { getStripe } from "../billing/stripeClient";
import { listEnabledTiers } from "../billing/tiersRepository";
import { listEnabledPacks } from "../billing/credits/packCatalog";
import { subscriptionStore } from "../billing/subscriptionStore";

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
const originalFetch = global.fetch;

beforeEach(() => {
  stripeMock = makeStripeMock();
  (getStripe as jest.Mock).mockReturnValue(stripeMock);
  subscriptionStore.clear();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  delete process.env.ZAPIER_WEBHOOK_URL;
  delete process.env.ZAPIER_BETA_SIGNUP_WEBHOOK_URL;
  delete process.env.ZAPIER_WAITLIST_SIGNUP_WEBHOOK_URL;
  delete process.env.PAPERCLIP_API_URL;
  delete process.env.PAPERCLIP_WEBHOOK_API_KEY;
  delete process.env.PAPERCLIP_COMPANY_ID;
  delete process.env.PAPERCLIP_CSM_AGENT_ID;
  delete process.env.PAPERCLIP_ONBOARDING_GOAL_ID;
  global.fetch = jest.fn();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe("GET /api/public/landing/pricing", () => {
  const sampleTiers = [
    {
      id: "explore",
      displayName: "Explore",
      priceUsdCents: 0,
      currency: "usd",
      stripePriceEnv: null,
      trialDays: 0,
      sortOrder: 10,
      isPopular: false,
      features: ["3 workspaces", "Daily Sonnet credit cap"],
      ctaLabel: "Get started",
      enabled: true,
    },
    {
      id: "flow",
      displayName: "Flow",
      priceUsdCents: 1900,
      currency: "usd",
      stripePriceEnv: "STRIPE_FLOW_PRICE_ID",
      trialDays: 14,
      sortOrder: 20,
      isPopular: false,
      features: ["Everything in Explore", "5,000 daily credits"],
      ctaLabel: "Start 14-day trial",
      enabled: true,
    },
  ];

  const samplePacks = [
    {
      id: "pack_25",
      displayName: "Starter Pack",
      stripePriceId: "price_test_pack_25",
      priceUsdCents: 2500,
      creditsGranted: 250000n,
      bonusPercent: 0,
      enabled: true,
      sortOrder: 10,
    },
    {
      id: "pack_50",
      displayName: "Plus Pack",
      stripePriceId: "price_test_pack_50",
      priceUsdCents: 5000,
      creditsGranted: 525000n,
      bonusPercent: 5,
      enabled: true,
      sortOrder: 20,
    },
  ];

  beforeEach(() => {
    (listEnabledTiers as jest.Mock).mockResolvedValue(sampleTiers);
    (listEnabledPacks as jest.Mock).mockResolvedValue(samplePacks);
  });

  it("returns tiers and packs together", async () => {
    const response = await request(app).get("/api/public/landing/pricing");

    expect(response.status).toBe(200);
    expect(response.body.tiers).toHaveLength(2);
    expect(response.body.packs).toHaveLength(2);
    expect(response.body.tiers[0]).toEqual({
      id: "explore",
      displayName: "Explore",
      priceUsdCents: 0,
      currency: "usd",
      trialDays: 0,
      sortOrder: 10,
      isPopular: false,
      features: ["3 workspaces", "Daily Sonnet credit cap"],
      ctaLabel: "Get started",
    });
    expect(response.body.packs[0]).toEqual({
      id: "pack_25",
      displayName: "Starter Pack",
      priceUsdCents: 2500,
      creditsGranted: 250000,
      bonusPercent: 0,
      sortOrder: 10,
    });
  });

  it("does not expose stripe_price_env or stripe_price_id to public clients", async () => {
    const response = await request(app).get("/api/public/landing/pricing");

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("stripePriceEnv");
    expect(serialized).not.toContain("STRIPE_FLOW_PRICE_ID");
    expect(serialized).not.toContain("stripePriceId");
    expect(serialized).not.toContain("price_test_pack_25");
  });

  it("sets a public 5-minute cache header", async () => {
    const response = await request(app).get("/api/public/landing/pricing");

    expect(response.headers["cache-control"]).toBe(
      "public, max-age=300, s-maxage=300",
    );
  });

  it("handles empty packs gracefully (no subscription packs configured yet)", async () => {
    (listEnabledPacks as jest.Mock).mockResolvedValue([]);

    const response = await request(app).get("/api/public/landing/pricing");

    expect(response.status).toBe(200);
    expect(response.body.tiers).toHaveLength(2);
    expect(response.body.packs).toEqual([]);
  });

  it("returns 500 if the tier catalog is unavailable", async () => {
    (listEnabledTiers as jest.Mock).mockRejectedValue(new Error("db down"));

    const response = await request(app).get("/api/public/landing/pricing");

    expect(response.status).toBe(500);
    expect(response.body.error).toMatch(/failed to load pricing/i);
  });
});

describe("POST /api/public/landing/checkout", () => {
  it("creates an unauthenticated checkout session for landing traffic", async () => {
    stripeMock.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.test/session_123",
    });

    const response = await request(app)
      .post("/api/public/landing/checkout")
      .set("Origin", "https://helloautoflow.com")
      .send({
        tier: "flow",
        email: "buyer@example.com",
        firstName: "Ada",
        companyName: "AutoFlow",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ url: "https://checkout.stripe.test/session_123" });
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url: "https://helloautoflow.com/success?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://helloautoflow.com/#pricing",
        customer_email: "buyer@example.com",
        subscription_data: { trial_period_days: 14 },
      })
    );
  });
});

describe("POST /api/public/landing/subscribe", () => {
  it("rejects invalid email addresses", async () => {
    const response = await request(app).post("/api/public/landing/subscribe").send({ email: "invalid" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/invalid email/i);
  });

  it("forwards valid subscriptions to the configured webhook", async () => {
    process.env.ZAPIER_WEBHOOK_URL = "https://hooks.example.test/subscribe";
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
    });

    const response = await request(app).post("/api/public/landing/subscribe").send({ email: "ops@example.com" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://hooks.example.test/subscribe",
      expect.objectContaining({
        method: "POST",
      })
    );
  });
});

describe("POST /api/public/landing/waitlist-signup", () => {
  it("keeps waitlist signup functional without a webhook", async () => {
    const response = await request(app).post("/api/public/landing/waitlist-signup").send({ email: "ops@example.com" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/stripe", () => {
  it("creates a CSM follow-up for automate and scale landing signups", async () => {
    process.env.PAPERCLIP_API_URL = "https://paperclip.example.test";
    process.env.PAPERCLIP_WEBHOOK_API_KEY = "pc_test";
    process.env.PAPERCLIP_COMPANY_ID = "company_123";
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ identifier: "ALT-9999" }),
    });

    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          metadata: {
            tier: "automate",
            userId: "user-123",
            email: "buyer@example.com",
            firstName: "Ada",
            companyName: "AutoFlow",
          },
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

    const response = await request(app)
      .post("/api/webhooks/stripe")
      .set("stripe-signature", "sig_test")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ id: "evt_1" }));

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://paperclip.example.test/api/companies/company_123/issues",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer pc_test",
        }),
      })
    );
  });
});
