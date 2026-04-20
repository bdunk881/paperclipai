import { createHmac } from "crypto";
import { posthogCredentialStore } from "./credentialStore";
import { PostHogClient } from "./posthogClient";
import { clearPkceState } from "./pkceStore";
import { PostHogConnectorService } from "./service";
import { clearPostHogWebhookReplayCache, verifyPostHogWebhook } from "./webhook";

function mockJsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

describe("PostHog connector", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      POSTHOG_CLIENT_ID: "client_123",
      POSTHOG_CLIENT_SECRET: "secret_123",
      POSTHOG_REDIRECT_URI: "https://autoflow.test/api/integrations/posthog/oauth/callback",
      POSTHOG_SCOPES: "projects:read feature_flags:read events:write",
      POSTHOG_OAUTH_BASE_URL: "https://app.posthog.com/oauth",
      POSTHOG_API_BASE_URL: "https://app.posthog.com",
      POSTHOG_CAPTURE_BASE_URL: "https://us.i.posthog.com",
      POSTHOG_WEBHOOK_SECRET: "posthog_webhook_secret",
    };

    clearPkceState();
    posthogCredentialStore.clear();
    clearPostHogWebhookReplayCache();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("builds an OAuth URL with PKCE state and challenge", () => {
    const service = new PostHogConnectorService();
    const result = service.beginOAuth("user-1");

    expect(result.authUrl).toContain("https://app.posthog.com/oauth/authorize");
    expect(result.authUrl).toContain("code_challenge_method=S256");
    expect(result.state).toBeTruthy();
    expect(result.codeVerifier).toBeTruthy();
    expect(result.expiresInSeconds).toBeGreaterThan(0);
  });

  it("completes OAuth and stores encrypted credentials", async () => {
    const service = new PostHogConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "posthog_oauth_token",
          refresh_token: "posthog_refresh_token",
          expires_in: 3600,
          scope: "projects:read feature_flags:read",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          results: [{ id: 91, name: "AutoFlow Analytics", organization: { id: 3, name: "Altitude" } }],
        })
      );

    const connection = await service.completeOAuth({ code: "oauth-code", state: start.state });

    expect(connection.authMethod).toBe("oauth2_pkce");
    expect(connection.organizationId).toBe("91");
    expect(connection.tokenMasked).toMatch(/^\*{4}/);
  });

  it("connects with API-key fallback and verifies auth", async () => {
    const service = new PostHogConnectorService();

    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      mockJsonResponse({
        results: [{ id: 101, name: "Product", organization: { id: 6, name: "Altitude" } }],
      })
    );

    const connection = await service.connectApiKey({
      userId: "user-1",
      apiKey: "posthog_api_key",
    });

    expect(connection.authMethod).toBe("api_key");
    expect(connection.organizationId).toBe("101");
  });

  it("returns down health when connector is not configured", async () => {
    const service = new PostHogConnectorService();
    const health = await service.health("missing-user");

    expect(health.status).toBe("down");
    expect(health.details.auth).toBe(false);
    expect(health.details.errorType).toBe("auth");
  });

  it("refreshes OAuth access token when token is near expiry", async () => {
    const service = new PostHogConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "posthog_old_token",
          refresh_token: "posthog_refresh_token",
          expires_in: 1,
          scope: "projects:read feature_flags:read",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          results: [{ id: 12, name: "Core Analytics", organization: { id: 3, name: "Altitude" } }],
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "posthog_new_token",
          refresh_token: "posthog_refresh_token_2",
          expires_in: 3600,
          scope: "projects:read feature_flags:read",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          results: [{ id: 12, name: "Core Analytics", organization: { id: 3, name: "Altitude" } }],
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          results: [{ id: 12, name: "Core Analytics", organization: { id: 3, name: "Altitude" } }],
        })
      );

    await service.completeOAuth({ code: "oauth-code", state: start.state });

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const connection = await service.testConnection("user-1");

    expect(connection.organizationId).toBe("12");
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("handles offset pagination for projects and feature flags", async () => {
    const client = new PostHogClient("posthog_token");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          results: [{ id: 1, name: "Core" }],
          next: "https://app.posthog.com/api/projects/?limit=100&offset=1",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          results: [{ id: 2, name: "Growth" }],
          next: null,
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          results: [
            { id: 81, key: "new_checkout", name: "New Checkout", active: true },
            { id: 82, key: "price_test", name: "Pricing Test", active: false },
          ],
          next: "https://app.posthog.com/api/projects/1/feature_flags/?limit=100&offset=2",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({ results: [], next: null })
      );

    const projects = await client.listProjects(200);
    const flags = await client.listFeatureFlags("1", 200);

    expect(projects).toHaveLength(2);
    expect(projects[0].id).toBe("1");
    expect(flags).toHaveLength(2);
    expect(flags[0].key).toBe("new_checkout");
  });

  it("retries on rate limiting and eventually succeeds", async () => {
    const client = new PostHogClient("posthog_token");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "0" },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          results: [{ id: 17, name: "AutoFlow" }],
        })
      );

    const result = await client.viewer();
    expect(result.organizationId).toBe("17");
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });

  it("captures events through PostHog ingest", async () => {
    const client = new PostHogClient("default_api_key");

    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      mockJsonResponse({ status: 1 })
    );

    const response = await client.captureEvent({
      event: "checkout_started",
      distinctId: "user-123",
      properties: { plan: "growth" },
      projectApiKey: "project_api_key",
    });

    expect(response.accepted).toBe(true);
    expect(response.status).toBe(1);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain("/capture/");
  });

  it("verifies PostHog webhook signatures and blocks replay", () => {
    const payload = Buffer.from(JSON.stringify({ event: "feature_flag_called" }), "utf8");
    const signature = createHmac("sha256", "posthog_webhook_secret").update(payload).digest("hex");

    verifyPostHogWebhook({
      rawBody: payload,
      signatureHeader: signature,
      deliveryIdHeader: "delivery-1",
      signingSecret: "posthog_webhook_secret",
    });

    expect(() =>
      verifyPostHogWebhook({
        rawBody: payload,
        signatureHeader: signature,
        deliveryIdHeader: "delivery-1",
        signingSecret: "posthog_webhook_secret",
      })
    ).toThrow("PostHog webhook replay detected");
  });
});
