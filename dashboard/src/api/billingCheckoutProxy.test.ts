import handler from "../../api/billing/checkout";

type MockReq = {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string };
};

type MockRes = {
  statusCode: number;
  payload: unknown;
  status: (code: number) => MockRes;
  json: (data: unknown) => MockRes;
  send: (data: unknown) => MockRes;
};

function makeReq(overrides: Partial<MockReq> = {}): MockReq {
  return {
    method: "POST",
    body: { tier: "flow" },
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    ...overrides,
  };
}

function makeRes(): MockRes {
  return {
    statusCode: 200,
    payload: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: unknown) {
      this.payload = data;
      return this;
    },
    send(data: unknown) {
      this.payload = data;
      return this;
    },
  };
}

describe("dashboard/api/billing/checkout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BILLING_API_BASE_URL;
    delete process.env.BACKEND_API_BASE_URL;
    delete process.env.VITE_API_BASE_URL;
    delete process.env.VITE_API_URL;
  });

  it("returns 405 for non-POST methods", async () => {
    const req = makeReq({ method: "GET" });
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(405);
    expect(res.payload).toEqual({ error: "Method not allowed" });
  });

  it("proxies JSON response from backend billing API", async () => {
    process.env.BILLING_API_BASE_URL = "https://billing.example.com";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ url: "https://checkout.stripe.test/sess_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const req = makeReq({ headers: { host: "dashboard.example.com", "x-forwarded-for": "1.2.3.4" } });
    const res = makeRes();

    await handler(req as never, res as never);

    expect(fetch).toHaveBeenCalledWith("https://billing.example.com/api/billing/checkout", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ tier: "flow" }),
    }));
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ url: "https://checkout.stripe.test/sess_123" });
  });

  it("returns generic checkout error on upstream non-JSON failure", async () => {
    process.env.BILLING_API_BASE_URL = "https://billing.example.com";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>bad gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
    );

    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(502);
    expect(res.payload).toEqual({ error: "Checkout failed" });
  });

  it("accepts VITE_API_BASE_URL values that already include /api", async () => {
    process.env.VITE_API_BASE_URL = "https://backend.example.com/api";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ url: "https://checkout.stripe.test/sess_456" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(fetch).toHaveBeenCalledWith("https://backend.example.com/api/billing/checkout", expect.any(Object));
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ url: "https://checkout.stripe.test/sess_456" });
  });

  it("falls back to the staging backend for the staging dashboard host", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Stripe pricing not configured for this tier" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    const req = makeReq({ headers: { host: "staging.app.helloautoflow.com" } });
    const res = makeRes();

    await handler(req as never, res as never);

    expect(fetch).toHaveBeenCalledWith(
      "https://staging-api.helloautoflow.com/api/billing/checkout",
      expect.any(Object),
    );
    expect(res.statusCode).toBe(503);
    expect(res.payload).toEqual({ error: "Stripe pricing not configured for this tier" });
  });
});
