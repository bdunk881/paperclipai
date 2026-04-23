import jwt from "jsonwebtoken";
import { GmailClient } from "./gmailClient";
import { gmailCredentialStore } from "./credentialStore";
import { clearPkceState } from "./pkceStore";
import { GmailConnectorService } from "./service";
import { clearGmailWebhookReplayCache, verifyGooglePubSubPush } from "./webhook";

jest.mock("jwks-rsa", () =>
  jest.fn(() => ({
    getSigningKey: (_kid: string, callback: (error: Error | null, key: { getPublicKey: () => string }) => void) =>
      callback(null, { getPublicKey: () => "test-public-key" }),
  }))
);

jest.mock("jsonwebtoken", () => ({
  verify: jest.fn(),
}));

function mockJsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

describe("Gmail connector", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GOOGLE_CLIENT_ID: "google-client-123",
      GOOGLE_CLIENT_SECRET: "google-secret-123",
      GMAIL_REDIRECT_URI: "https://autoflow.test/api/integrations/gmail/oauth/callback",
      GMAIL_SCOPES:
        "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
      GMAIL_PUBSUB_AUDIENCE: "https://autoflow.test/api/webhooks/gmail/pubsub",
      GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL: "gmail-push@system.gserviceaccount.com",
    };

    clearPkceState();
    gmailCredentialStore.clear();
    clearGmailWebhookReplayCache();
    jest.restoreAllMocks();
    (jwt.verify as jest.Mock).mockImplementation(
      (
        _token: string,
        _getSigningKey: unknown,
        _options: unknown,
        callback: (error: Error | null, decoded?: object) => void
      ) => {
        callback(null, {
          email: "gmail-push@system.gserviceaccount.com",
          aud: "https://autoflow.test/api/webhooks/gmail/pubsub",
          iss: "https://accounts.google.com",
        });
      }
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("builds an OAuth URL with PKCE state and challenge", () => {
    const service = new GmailConnectorService();
    const result = service.beginOAuth("user-1");

    expect(result.authUrl).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(result.authUrl).toContain("code_challenge_method=S256");
    expect(result.state).toBeTruthy();
    expect(result.codeVerifier).toBeTruthy();
    expect(result.expiresInSeconds).toBeGreaterThan(0);
  });

  it("completes OAuth and stores encrypted credentials", async () => {
    const service = new GmailConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "ya29.oauth-access",
          refresh_token: "refresh-token-123",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          emailAddress: "ops@autoflow.test",
          historyId: "1001",
          messagesTotal: 10,
          threadsTotal: 4,
        })
      );

    const connection = await service.completeOAuth({ code: "oauth-code", state: start.state });

    expect(connection.authMethod).toBe("oauth2_pkce");
    expect(connection.emailAddress).toBe("ops@autoflow.test");
    expect(connection.tokenMasked).toMatch(/^\*{4}/);
  });

  it("connects with API-key fallback and verifies profile access", async () => {
    const service = new GmailConnectorService();

    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      mockJsonResponse({
        emailAddress: "api@autoflow.test",
        historyId: "1002",
      })
    );

    const connection = await service.connectApiKey({
      userId: "user-1",
      apiKey: "ya29.api-fallback",
    });

    expect(connection.authMethod).toBe("api_key");
    expect(connection.emailAddress).toBe("api@autoflow.test");
  });

  it("returns down health when connector is not configured", async () => {
    const service = new GmailConnectorService();
    const health = await service.health("missing-user");

    expect(health.status).toBe("down");
    expect(health.details.auth).toBe(false);
    expect(health.details.errorType).toBe("auth");
  });

  it("refreshes OAuth access token when the token is near expiry", async () => {
    const service = new GmailConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "ya29.old-token",
          refresh_token: "refresh-token-123",
          expires_in: 1,
          scope: "https://www.googleapis.com/auth/gmail.readonly",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          emailAddress: "ops@autoflow.test",
          historyId: "2000",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "ya29.new-token",
          refresh_token: "refresh-token-999",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/gmail.readonly",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          emailAddress: "ops@autoflow.test",
          historyId: "2001",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          emailAddress: "ops@autoflow.test",
          historyId: "2001",
        })
      );

    await service.completeOAuth({ code: "oauth-code", state: start.state });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const connection = await service.testConnection("user-1");

    expect(connection.emailAddress).toBe("ops@autoflow.test");
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("handles page-token pagination for Gmail message listing", async () => {
    const client = new GmailClient("ya29.token");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          messages: [{ id: "m1", threadId: "t1" }],
          nextPageToken: "next-page",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          messages: [{ id: "m2", threadId: "t2" }],
        })
      );

    const messages = await client.listMessages({ maxResults: 100 });

    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe("m1");
    expect(messages[1].id).toBe("m2");
  });

  it("retries on rate limiting and eventually succeeds", async () => {
    const client = new GmailClient("ya29.token");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "rateLimitExceeded" } }), {
          status: 429,
          headers: { "Retry-After": "0" },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          emailAddress: "retry@autoflow.test",
          historyId: "333",
        })
      );

    const profile = await client.getProfile();
    expect(profile.emailAddress).toBe("retry@autoflow.test");
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(2);
  });

  it("verifies Gmail Pub/Sub webhook auth and blocks replay", async () => {
    const body = {
      subscription: "projects/autoflow/subscriptions/gmail",
      message: {
        data: Buffer.from(
          JSON.stringify({ emailAddress: "ops@autoflow.test", historyId: "901" }),
          "utf8"
        ).toString("base64"),
        messageId: "pubsub-msg-1",
        publishTime: new Date().toISOString(),
      },
    };

    const result = await verifyGooglePubSubPush({
      authorizationHeader: "Bearer signed-token",
      body,
    });

    expect(result.emailAddress).toBe("ops@autoflow.test");
    expect(result.historyId).toBe("901");

    await expect(
      verifyGooglePubSubPush({
        authorizationHeader: "Bearer signed-token",
        body,
      })
    ).rejects.toThrow(/replay/i);
  });
});
