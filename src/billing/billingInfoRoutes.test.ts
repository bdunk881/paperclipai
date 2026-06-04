/**
 * HEL-402: billing info endpoints (payment-method, next-invoice) + portal session.
 */

jest.mock("./stripeClient", () => ({ getStripe: jest.fn() }));
jest.mock("./subscriptionStore", () => ({
  subscriptionStore: { getByUserId: jest.fn() },
}));

import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import billingInfoRoutes from "./billingInfoRoutes";
import { getStripe } from "./stripeClient";
import { subscriptionStore } from "./subscriptionStore";

const mockGetStripe = getStripe as jest.MockedFunction<typeof getStripe>;
const mockGetByUserId = subscriptionStore.getByUserId as jest.MockedFunction<
  typeof subscriptionStore.getByUserId
>;

function buildApp(userId: string | null = "user-1"): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (userId) {
      (req as Request & { auth?: { sub: string } }).auth = { sub: userId };
    }
    next();
  });
  app.use("/api/billing", billingInfoRoutes);
  return app;
}

function withStripe(stripe: Record<string, unknown>): void {
  mockGetStripe.mockReturnValue(stripe as never);
}

function withCustomer(stripeCustomerId: string | null): void {
  mockGetByUserId.mockResolvedValue(
    stripeCustomerId ? ({ stripeCustomerId } as never) : undefined,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/billing/payment-method (HEL-402)", () => {
  it("returns the default card brand/last4/exp", async () => {
    withCustomer("cus_1");
    withStripe({
      customers: {
        retrieve: jest.fn().mockResolvedValue({
          invoice_settings: {
            default_payment_method: {
              card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
            },
          },
        }),
      },
    });

    const res = await request(buildApp()).get("/api/billing/payment-method");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      paymentMethod: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 },
    });
  });

  it("falls back to the first card on file when no default PM", async () => {
    withCustomer("cus_1");
    withStripe({
      customers: { retrieve: jest.fn().mockResolvedValue({ invoice_settings: {} }) },
      paymentMethods: {
        list: jest.fn().mockResolvedValue({
          data: [{ card: { brand: "mastercard", last4: "1111", exp_month: 1, exp_year: 2029 } }],
        }),
      },
    });

    const res = await request(buildApp()).get("/api/billing/payment-method");
    expect(res.body.paymentMethod).toMatchObject({ brand: "mastercard", last4: "1111" });
  });

  it("returns { paymentMethod: null } when the user has no Stripe customer", async () => {
    withCustomer(null);
    const res = await request(buildApp()).get("/api/billing/payment-method");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ paymentMethod: null });
    expect(mockGetStripe).not.toHaveBeenCalled();
  });

  it("401s without an authenticated user", async () => {
    const res = await request(buildApp(null)).get("/api/billing/payment-method");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/billing/next-invoice (HEL-402)", () => {
  it("returns the upcoming invoice via createPreview", async () => {
    withCustomer("cus_1");
    withStripe({
      invoices: {
        createPreview: jest
          .fn()
          .mockResolvedValue({ amount_due: 2900, currency: "usd", period_end: 1788000000 }),
      },
    });

    const res = await request(buildApp()).get("/api/billing/next-invoice");
    expect(res.body.invoice).toEqual({
      amountDue: 2900,
      currency: "usd",
      periodEnd: new Date(1788000000 * 1000).toISOString(),
    });
  });

  it("returns { invoice: null } when there is no upcoming invoice", async () => {
    withCustomer("cus_1");
    withStripe({
      invoices: {
        createPreview: jest
          .fn()
          .mockRejectedValue(Object.assign(new Error("none"), { code: "invoice_upcoming_none" })),
      },
    });

    const res = await request(buildApp()).get("/api/billing/next-invoice");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ invoice: null });
  });

  it("returns { invoice: null } when the user has no Stripe customer", async () => {
    withCustomer(null);
    const res = await request(buildApp()).get("/api/billing/next-invoice");
    expect(res.body).toEqual({ invoice: null });
  });
});

describe("POST /api/billing/portal-session (HEL-402)", () => {
  it("returns a Stripe billing-portal url", async () => {
    withCustomer("cus_1");
    const create = jest.fn().mockResolvedValue({ url: "https://billing.stripe.com/session/abc" });
    withStripe({ billingPortal: { sessions: { create } } });

    const res = await request(buildApp()).post("/api/billing/portal-session").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: "https://billing.stripe.com/session/abc" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_1", return_url: expect.stringContaining("/billing") }),
    );
  });

  it("404s when the user has no Stripe customer", async () => {
    withCustomer(null);
    const res = await request(buildApp()).post("/api/billing/portal-session").send({});
    expect(res.status).toBe(404);
  });
});
