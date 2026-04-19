import { createHmac } from "crypto";
import { AzureMonitorClient } from "./azureMonitorClient";
import { monitoringCredentialStore } from "./credentialStore";
import { DatadogClient } from "./datadogClient";
import { clearPkceState } from "./pkceStore";
import { DatadogAzureMonitorConnectorService } from "./service";
import {
  clearMonitoringWebhookReplayCache,
  verifyMonitoringWebhook,
} from "./webhook";

function mockJsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

describe("Datadog/Azure Monitor connector", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      AZURE_MONITOR_CLIENT_ID: "azure_client_123",
      AZURE_MONITOR_CLIENT_SECRET: "azure_secret_123",
      AZURE_MONITOR_REDIRECT_URI: "https://autoflow.test/api/integrations/datadog-azure-monitor/oauth/callback",
      AZURE_MONITOR_SCOPES: "openid profile offline_access https://management.azure.com/.default",
      AZURE_MONITOR_WEBHOOK_SIGNING_KEY: "azure_webhook_secret",
      DATADOG_WEBHOOK_SIGNING_KEY: "datadog_webhook_secret",
    };

    clearPkceState();
    monitoringCredentialStore.clear();
    clearMonitoringWebhookReplayCache();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("builds Azure OAuth URL with PKCE", () => {
    const service = new DatadogAzureMonitorConnectorService();
    const result = service.beginAzureOAuth("user-1");

    expect(result.authUrl).toContain("https://login.microsoftonline.com");
    expect(result.authUrl).toContain("code_challenge_method=S256");
    expect(result.state).toBeTruthy();
    expect(result.codeVerifier).toBeTruthy();
    expect(result.expiresInSeconds).toBeGreaterThan(0);
  });

  it("completes Azure OAuth and stores encrypted credentials", async () => {
    const service = new DatadogAzureMonitorConnectorService();
    const start = service.beginAzureOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "azure_oauth_token",
          refresh_token: "azure_refresh_token",
          expires_in: 3600,
          scope: "openid profile",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          value: [{
            subscriptionId: "sub-1",
            displayName: "Production",
            state: "Enabled",
          }],
        })
      );

    const connection = await service.completeAzureOAuth({ code: "oauth-code", state: start.state });

    expect(connection.provider).toBe("azure_monitor");
    expect(connection.authMethod).toBe("oauth2_pkce");
    expect(connection.accountId).toBe("sub-1");
    expect(connection.tokenMasked).toMatch(/^\*{4}/);
  });

  it("connects Datadog with API-key fallback", async () => {
    const service = new DatadogAzureMonitorConnectorService();

    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      mockJsonResponse({ valid: true })
    );

    const connection = await service.connectDatadogApiKey({
      userId: "user-1",
      apiKey: "dd_api_key",
      appKey: "dd_app_key",
      site: "datadoghq.com",
    });

    expect(connection.provider).toBe("datadog");
    expect(connection.authMethod).toBe("api_key");
    expect(connection.accountId).toBe("datadoghq.com");
  });

  it("returns down health when no credential is configured", async () => {
    const service = new DatadogAzureMonitorConnectorService();
    const health = await service.health("missing-user");

    expect(health.status).toBe("down");
    expect(health.details.auth).toBe(false);
    expect(health.details.errorType).toBe("auth");
  });

  it("refreshes Azure OAuth token when near expiry", async () => {
    const service = new DatadogAzureMonitorConnectorService();
    const start = service.beginAzureOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "azure_old_token",
          refresh_token: "azure_refresh_token",
          expires_in: 1,
          scope: "openid profile",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          value: [{ subscriptionId: "sub-1", displayName: "Production", state: "Enabled" }],
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "azure_new_token",
          refresh_token: "azure_refresh_token_2",
          expires_in: 3600,
          scope: "openid profile",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          value: [{ subscriptionId: "sub-1", displayName: "Production", state: "Enabled" }],
        })
      );

    await service.completeAzureOAuth({ code: "oauth-code", state: start.state });
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const subscriptions = await service.listAzureSubscriptions("user-1");
    expect(subscriptions[0]?.subscriptionId).toBe("sub-1");
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("handles pagination for Azure subscription listing", async () => {
    const client = new AzureMonitorClient("azure_token");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          value: [{ subscriptionId: "sub-1", displayName: "First" }],
          nextLink: "https://management.azure.com/subscriptions?page=2",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          value: [{ subscriptionId: "sub-2", displayName: "Second" }],
        })
      );

    const subscriptions = await client.listSubscriptions();

    expect(subscriptions).toHaveLength(2);
    expect(subscriptions[0].subscriptionId).toBe("sub-1");
    expect(subscriptions[1].subscriptionId).toBe("sub-2");
  });

  it("retries Datadog requests on rate limits", async () => {
    const client = new DatadogClient({ apiKey: "dd_api_key" });

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: ["rate limited"] }), {
          status: 429,
          headers: { "Retry-After": "0" },
        })
      )
      .mockResolvedValueOnce(mockJsonResponse({ valid: true }));

    const validation = await client.validate();
    expect(validation.valid).toBe(true);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });

  it("verifies webhook signatures and blocks replay", () => {
    const payload = Buffer.from(JSON.stringify({ event_type: "alert" }), "utf8");
    const signature = createHmac("sha256", "datadog_webhook_secret").update(payload).digest("hex");

    verifyMonitoringWebhook({
      provider: "datadog",
      rawBody: payload,
      signatureHeader: signature,
      deliveryIdHeader: "delivery-1",
      signingSecret: "datadog_webhook_secret",
    });

    expect(() =>
      verifyMonitoringWebhook({
        provider: "datadog",
        rawBody: payload,
        signatureHeader: signature,
        deliveryIdHeader: "delivery-1",
        signingSecret: "datadog_webhook_secret",
      })
    ).toThrow("datadog webhook replay detected");
  });
});
