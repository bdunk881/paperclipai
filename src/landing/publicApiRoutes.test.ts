jest.mock("../engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));

jest.mock("../billing/stripeClient", () => ({
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
