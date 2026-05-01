import { createHmac } from "crypto";
import { hubSpotCredentialStore } from "./credentialStore";
import { HubSpotClient } from "./hubspotClient";
import { clearOAuthState } from "./oauthStateStore";
import { HubSpotConnectorService } from "./service";
import { clearHubSpotWebhookReplayCache, verifyHubSpotWebhook } from "./webhook";

function mockJsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

describe("HubSpot connector", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      HUBSPOT_CLIENT_ID: "hubspot_client_123",
      HUBSPOT_CLIENT_SECRET: "hubspot_secret_123",
      HUBSPOT_REDIRECT_URI: "https://autoflow.test/api/integrations/hubspot/oauth/callback",
      HUBSPOT_SCOPES: "crm.objects.contacts.read crm.objects.contacts.write crm.objects.companies.read crm.objects.companies.write crm.objects.deals.read crm.objects.deals.write",
    };

    clearOAuthState();
    hubSpotCredentialStore.clear();
    clearHubSpotWebhookReplayCache();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("builds an OAuth URL with state", () => {
    const service = new HubSpotConnectorService();
    const result = service.beginOAuth("user-1");

    expect(result.authUrl).toContain("https://app.hubspot.com/oauth/authorize");
    expect(result.authUrl).toContain("response_type=code");
    expect(result.authUrl).toContain("crm.objects.contacts.read");
    expect(result.state).toBeTruthy();
    expect(result.expiresInSeconds).toBeGreaterThan(0);
  });

  it("completes OAuth and stores encrypted credentials", async () => {
    const service = new HubSpotConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "hubspot_oauth_token",
          refresh_token: "hubspot_refresh_token",
          expires_in: 3600,
          scope: "crm.objects.contacts.read crm.objects.contacts.write",
          hub_id: 12345,
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          hub_id: 12345,
          hub_domain: "autoflow-test",
          scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
        })
      );

    const connection = await service.completeOAuth({ code: "oauth-code", state: start.state });

    expect(connection.authMethod).toBe("oauth2");
    expect(connection.hubId).toBe("12345");
    expect(connection.hubDomain).toBe("autoflow-test");
    expect(connection.tokenMasked).toMatch(/^\*{4}/);
  });

  it("connects with private-app token fallback and verifies auth", async () => {
    const service = new HubSpotConnectorService();

    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      mockJsonResponse({
        hub_id: 777,
        hub_domain: "private-app-hub",
        scopes: ["crm.objects.deals.read"],
      })
    );

    const connection = await service.connectApiKey({
      userId: "user-1",
      apiKey: "hubspot_private_app_token",
    });

    expect(connection.authMethod).toBe("api_key");
    expect(connection.hubId).toBe("777");
    expect(connection.hubDomain).toBe("private-app-hub");
  });

  it("returns disabled health when connector is not configured", async () => {
    const service = new HubSpotConnectorService();
    const health = await service.health("missing-user");

    expect(health.status).toBe("disabled");
    expect(health.details.auth).toBe(false);
    expect(health.recommendedNextAction).toMatch(/connect a hubspot credential/i);
  });

  it("refreshes OAuth access token when token is near expiry", async () => {
    const service = new HubSpotConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "hubspot_old_token",
          refresh_token: "hubspot_refresh_token",
          expires_in: 1,
          scopes: ["crm.objects.contacts.read"],
          hub_id: 12345,
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          hub_id: 12345,
          hub_domain: "autoflow-test",
          scopes: ["crm.objects.contacts.read"],
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "hubspot_new_token",
          refresh_token: "hubspot_refresh_token_2",
          expires_in: 3600,
          scopes: ["crm.objects.contacts.read", "crm.objects.companies.read"],
          hub_id: 12345,
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          hub_id: 12345,
          hub_domain: "autoflow-test",
          scopes: ["crm.objects.contacts.read", "crm.objects.companies.read"],
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          hub_id: 12345,
          hub_domain: "autoflow-test",
          scopes: ["crm.objects.contacts.read", "crm.objects.companies.read"],
        })
      );

    await service.completeOAuth({ code: "oauth-code", state: start.state });

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const connection = await service.testConnection("user-1");

    expect(connection.hubId).toBe("12345");
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("handles cursor pagination in CRM object listing", async () => {
    const client = new HubSpotClient("hubspot_private_app_token", "api_key");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          results: [
            {
              id: "c1",
              properties: { email: "ada@example.com", firstname: "Ada" },
              createdAt: "2026-04-20T00:00:00.000Z",
              updatedAt: "2026-04-20T00:00:00.000Z",
              archived: false,
            },
          ],
          paging: { next: { after: "cursor-1" } },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          results: [
            {
              id: "c2",
              properties: { email: "grace@example.com", firstname: "Grace" },
              createdAt: "2026-04-20T00:00:00.000Z",
              updatedAt: "2026-04-20T00:00:00.000Z",
              archived: false,
            },
          ],
        })
      );

    const contacts = await client.listContacts(100);

    expect(contacts).toHaveLength(2);
    expect(contacts[0].id).toBe("c1");
    expect(contacts[1].firstname).toBe("Grace");
  });

  it("retries on rate limiting and eventually succeeds", async () => {
    const client = new HubSpotClient("hubspot_private_app_token", "api_key");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(mockJsonResponse({ error: "rate limited" }, 429, { "Retry-After": "0" }))
      .mockResolvedValueOnce(
        mockJsonResponse({
          hub_id: 777,
          hub_domain: "private-app-hub",
          scopes: ["crm.objects.deals.read"],
        })
      );

    const viewer = await client.viewer();

    expect(viewer.hubId).toBe("777");
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(2);
  });

  it("validates webhook signatures and blocks replayed events", () => {
    const rawBody = Buffer.from(JSON.stringify([{ subscriptionType: "contact.creation" }]), "utf8");
    const timestamp = String(Date.now());
    const requestUri = "https://autoflow.test/api/webhooks/hubspot/events";
    const source = `POST${requestUri}${rawBody.toString("utf8")}${timestamp}`;
    const signature = createHmac("sha256", "hubspot_secret_123")
      .update(source, "utf8")
      .digest("base64");

    expect(() => verifyHubSpotWebhook({
      method: "POST",
      requestUri,
      rawBody,
      signatureHeader: signature,
      timestampHeader: timestamp,
      eventIdHeader: "evt-1",
      clientSecret: "hubspot_secret_123",
    })).not.toThrow();

    expect(() => verifyHubSpotWebhook({
      method: "POST",
      requestUri,
      rawBody,
      signatureHeader: signature,
      timestampHeader: timestamp,
      eventIdHeader: "evt-1",
      clientSecret: "hubspot_secret_123",
    })).toThrow(/replay/i);
  });
});
