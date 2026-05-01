import { createHmac } from "crypto";
import { StripeConnectorClient } from "./stripeClient";
import { stripeCredentialStore } from "./credentialStore";
import { clearOAuthState } from "./oauthStateStore";
import { StripeConnectorService } from "./service";
import { clearStripeWebhookReplayCache, verifyStripeWebhook } from "./webhook";

function mockJsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

describe("Stripe connector", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      STRIPE_CLIENT_ID: "ca_test_123",
      STRIPE_CLIENT_SECRET: "sk_test_platform_123",
      STRIPE_REDIRECT_URI: "https://autoflow.test/api/integrations/stripe/oauth/callback",
      STRIPE_OAUTH_SCOPE: "read_write",
    };

    clearOAuthState();
    stripeCredentialStore.clear();
    clearStripeWebhookReplayCache();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("builds an OAuth URL with state", () => {
    const service = new StripeConnectorService();
    const result = service.beginOAuth("user-1");

    expect(result.authUrl).toContain("https://connect.stripe.com/oauth/authorize");
    expect(result.authUrl).toContain("response_type=code");
    expect(result.authUrl).toContain("scope=read_write");
    expect(result.state).toBeTruthy();
    expect(result.expiresInSeconds).toBeGreaterThan(0);
  });

  it("completes OAuth and stores encrypted credentials", async () => {
    const service = new StripeConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "sk_test_connected",
          refresh_token: "rt_test_connected",
          scope: "read_write",
          stripe_user_id: "acct_oauth",
          livemode: false,
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: "acct_oauth",
          email: "ops@autoflow.test",
          business_profile: { name: "AutoFlow Ops" },
          livemode: false,
        })
      );

    const connection = await service.completeOAuth({ code: "oauth-code", state: start.state });

    expect(connection.authMethod).toBe("oauth2");
    expect(connection.accountId).toBe("acct_oauth");
    expect(connection.accountName).toBe("AutoFlow Ops");
    expect(connection.tokenMasked).toMatch(/^\*{4}/);
  });

  it("connects with API key fallback", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      mockJsonResponse({
        id: "acct_api",
        email: "billing@autoflow.test",
        settings: { dashboard: { display_name: "Billing Workspace" } },
        livemode: false,
      })
    );

    const service = new StripeConnectorService();
    const connection = await service.connectApiKey({
      userId: "user-1",
      apiKey: "sk_test_api_key",
    });

    expect(connection.authMethod).toBe("api_key");
    expect(connection.accountId).toBe("acct_api");
    expect(connection.accountName).toBe("Billing Workspace");
  });

  it("returns disabled health when connector is not configured", async () => {
    const service = new StripeConnectorService();
    const health = await service.health("missing-user");

    expect(health.status).toBe("disabled");
    expect(health.details.auth).toBe(false);
    expect(health.recommendedNextAction).toMatch(/connect a stripe credential/i);
  });

  it("refreshes an OAuth credential when an auth error occurs", async () => {
    const service = new StripeConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "sk_test_expiring",
          refresh_token: "rt_test_initial",
          scope: "read_write",
          stripe_user_id: "acct_oauth",
          livemode: false,
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: "acct_oauth",
          email: "ops@autoflow.test",
          business_profile: { name: "AutoFlow Ops" },
          livemode: false,
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({ error: { message: "Expired API Key provided" } }, 401)
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "sk_test_refreshed",
          refresh_token: "rt_test_refreshed",
          scope: "read_write",
          stripe_user_id: "acct_oauth",
          livemode: false,
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: "acct_oauth",
          email: "ops@autoflow.test",
          business_profile: { name: "AutoFlow Ops" },
          livemode: false,
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: "acct_oauth",
          email: "ops@autoflow.test",
          business_profile: { name: "AutoFlow Ops" },
          livemode: false,
        })
      );

    await service.completeOAuth({ code: "oauth-code", state: start.state });
    const result = await service.testConnection("user-1");

    expect(result.accountId).toBe("acct_oauth");
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it("handles cursor pagination for customers", async () => {
    const client = new StripeConnectorClient("sk_test_connected", "oauth2");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          object: "list",
          has_more: true,
          data: [
            { id: "cus_1", email: "a@test.dev", created: 1, livemode: false },
          ],
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          object: "list",
          has_more: false,
          data: [
            { id: "cus_2", email: "b@test.dev", created: 2, livemode: false },
          ],
        })
      );

    const customers = await client.listCustomers(100);

    expect(customers).toHaveLength(2);
    expect(customers[1].id).toBe("cus_2");
  });

  it("retries on rate limiting and eventually succeeds", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(mockJsonResponse({ error: { message: "rate limited" } }, 429, { "Retry-After": "0" }))
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: "acct_retry",
          email: "retry@autoflow.test",
          livemode: false,
        })
      );

    const client = new StripeConnectorClient("sk_test_connected", "oauth2");
    const viewer = await client.viewer();

    expect(viewer.accountId).toBe("acct_retry");
    expect(fetchSpy.mock.calls).toHaveLength(2);
  });

  it("validates webhook signatures and blocks replayed events", () => {
    const event = {
      id: "evt_test_1",
      type: "payment_intent.succeeded",
      created: Math.floor(Date.now() / 1000),
      account: "acct_test",
      livemode: false,
      data: { object: { id: "pi_123" } },
    };
    const rawBody = Buffer.from(JSON.stringify(event), "utf8");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", "whsec_test_123")
      .update(`${timestamp}.${rawBody.toString("utf8")}`)
      .digest("hex");

    expect(() =>
      verifyStripeWebhook({
        rawBody,
        signatureHeader: `t=${timestamp},v1=${signature}`,
        signingSecret: "whsec_test_123",
      })
    ).not.toThrow();

    expect(() =>
      verifyStripeWebhook({
        rawBody,
        signatureHeader: `t=${timestamp},v1=${signature}`,
        signingSecret: "whsec_test_123",
      })
    ).toThrow(/replay/i);
  });
});
