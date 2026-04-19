import { createHmac } from "crypto";
import { intercomCredentialStore } from "./credentialStore";
import { IntercomClient } from "./intercomClient";
import { clearPkceState } from "./pkceStore";
import { IntercomConnectorService } from "./service";
import { clearIntercomWebhookReplayCache, verifyIntercomWebhook } from "./webhook";

function mockJsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

describe("Intercom connector", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      INTERCOM_CLIENT_ID: "client_123",
      INTERCOM_CLIENT_SECRET: "secret_123",
      INTERCOM_REDIRECT_URI: "https://autoflow.test/api/integrations/intercom/oauth/callback",
      INTERCOM_SCOPES: "read_conversations read_contacts",
      INTERCOM_WEBHOOK_SECRET: "intercom_webhook_secret",
      INTERCOM_OAUTH_AUTHORIZE_URL: "https://app.intercom.com/oauth",
      INTERCOM_OAUTH_TOKEN_BASE_URL: "https://api.intercom.io/auth/eagle",
      INTERCOM_API_BASE_URL: "https://api.intercom.io",
    };

    clearPkceState();
    intercomCredentialStore.clear();
    clearIntercomWebhookReplayCache();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("builds an OAuth URL with PKCE state and challenge", () => {
    const service = new IntercomConnectorService();
    const result = service.beginOAuth("user-1");

    expect(result.authUrl).toContain("https://app.intercom.com/oauth?");
    expect(result.authUrl).toContain("code_challenge_method=S256");
    expect(result.state).toBeTruthy();
    expect(result.codeVerifier).toBeTruthy();
    expect(result.expiresInSeconds).toBeGreaterThan(0);
  });

  it("completes OAuth and stores encrypted credentials", async () => {
    const service = new IntercomConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "ic_oauth_token",
          refresh_token: "ic_refresh_token",
          expires_in: 3600,
          scope: "read_conversations read_contacts",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          type: "admin",
          id: "admin-1",
          app: { id: "workspace-1", name: "AutoFlow Workspace" },
        })
      );

    const connection = await service.completeOAuth({ code: "oauth-code", state: start.state });

    expect(connection.authMethod).toBe("oauth2_pkce");
    expect(connection.workspaceId).toBe("workspace-1");
    expect(connection.tokenMasked).toMatch(/^\*{4}/);
  });

  it("connects with API-key fallback and verifies auth", async () => {
    const service = new IntercomConnectorService();

    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      mockJsonResponse({
        type: "admin",
        id: "admin-api",
        app: { id: "workspace-api", name: "API Workspace" },
      })
    );

    const connection = await service.connectApiKey({
      userId: "user-1",
      apiKey: "ic_api_key",
    });

    expect(connection.authMethod).toBe("api_key");
    expect(connection.workspaceId).toBe("workspace-api");
  });

  it("returns down health when connector is not configured", async () => {
    const service = new IntercomConnectorService();
    const health = await service.health("missing-user");

    expect(health.status).toBe("down");
    expect(health.details.auth).toBe(false);
    expect(health.details.errorType).toBe("auth");
  });

  it("refreshes OAuth access token when token is near expiry", async () => {
    const service = new IntercomConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "ic_old_token",
          refresh_token: "ic_refresh_token",
          expires_in: 1,
          scope: "read_conversations read_contacts",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          type: "admin",
          id: "admin-1",
          app: { id: "workspace-1", name: "AutoFlow Workspace" },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "ic_new_token",
          refresh_token: "ic_refresh_token_2",
          expires_in: 3600,
          scope: "read_conversations read_contacts",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          type: "admin",
          id: "admin-1",
          app: { id: "workspace-1", name: "AutoFlow Workspace" },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          type: "admin",
          id: "admin-1",
          app: { id: "workspace-1", name: "AutoFlow Workspace" },
        })
      );

    await service.completeOAuth({ code: "oauth-code", state: start.state });
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const connection = await service.testConnection("user-1");

    expect(connection.workspaceId).toBe("workspace-1");
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("handles cursor pagination in contact and conversation listing", async () => {
    const client = new IntercomClient("ic_token");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: [{ id: "c1", email: "a@x.com", name: "A", role: "user", created_at: 1700000000 }],
          pages: { next: { starting_after: "cursor-1" } },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: [{ id: "c2", email: "b@x.com", name: "B", role: "lead", created_at: 1700000001 }],
          pages: {},
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          conversations: [{ id: "conv-1", title: "First", state: "open", created_at: 1700000002, updated_at: 1700000003 }],
          pages: {},
        })
      );

    const contacts = await client.listContacts(100);
    const conversations = await client.listConversations(100);

    expect(contacts).toHaveLength(2);
    expect(contacts[0].id).toBe("c1");
    expect(conversations).toHaveLength(1);
    expect(conversations[0].id).toBe("conv-1");
  });

  it("retries on rate limiting and eventually succeeds", async () => {
    const client = new IntercomClient("ic_token");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "rate limited" }), {
          status: 429,
          headers: { "Retry-After": "0" },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          type: "admin",
          id: "admin-1",
          app: { id: "workspace-1", name: "AutoFlow Workspace" },
        })
      );

    const result = await client.viewer();
    expect(result.workspaceId).toBe("workspace-1");
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });

  it("verifies Intercom webhook signatures and blocks replay", () => {
    const payload = Buffer.from(JSON.stringify({ topic: "conversation.user.created" }), "utf8");
    const signature = createHmac("sha256", "intercom_webhook_secret").update(payload).digest("hex");

    verifyIntercomWebhook({
      rawBody: payload,
      signatureHeader: `sha256=${signature}`,
      deliveryIdHeader: "delivery-1",
      signingSecret: "intercom_webhook_secret",
    });

    expect(() =>
      verifyIntercomWebhook({
        rawBody: payload,
        signatureHeader: `sha256=${signature}`,
        deliveryIdHeader: "delivery-1",
        signingSecret: "intercom_webhook_secret",
      })
    ).toThrow("Intercom webhook replay detected");
  });
});
