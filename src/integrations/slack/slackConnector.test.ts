import { createHmac } from "crypto";
import { clearPkceState } from "./pkceStore";
import { slackCredentialStore } from "./credentialStore";
import { SlackConnectorService } from "./service";
import { clearSlackWebhookReplayCache, verifySlackSignature } from "./webhook";
import { SlackClient } from "./slackClient";

function mockJsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

describe("Slack connector", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SLACK_CLIENT_ID: "client_123",
      SLACK_CLIENT_SECRET: "secret_123",
      SLACK_REDIRECT_URI: "https://autoflow.test/api/integrations/slack/oauth/callback",
      SLACK_SCOPES: "channels:read,chat:write",
      SLACK_SIGNING_SECRET: "signing_secret",
    };

    clearPkceState();
    slackCredentialStore.clear();
    clearSlackWebhookReplayCache();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("builds an OAuth URL with PKCE state and challenge", () => {
    const service = new SlackConnectorService();
    const result = service.beginOAuth("user-1");

    expect(result.authUrl).toContain("https://slack.com/oauth/v2/authorize");
    expect(result.authUrl).toContain("code_challenge_method=S256");
    expect(result.state).toBeTruthy();
    expect(result.codeVerifier).toBeTruthy();
    expect(result.expiresInSeconds).toBeGreaterThan(0);
  });

  it("completes OAuth and stores encrypted credentials", async () => {
    const service = new SlackConnectorService();
    const start = service.beginOAuth("user-1");

    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          ok: true,
          access_token: "xoxb-test-oauth-token",
          refresh_token: "refresh-token-123",
          expires_in: 3600,
          scope: "channels:read,chat:write",
          team: { id: "T123", name: "AutoFlow" },
          bot_user_id: "U123",
          authed_user: { scope: "channels:read" },
        })
      );

    const connection = await service.completeOAuth({ code: "oauth-code", state: start.state });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(connection.authMethod).toBe("oauth2_pkce");
    expect(connection.teamId).toBe("T123");
    expect(connection.tokenMasked).toMatch(/^\*{4}/);
  });

  it("connects with API-key fallback and verifies auth", async () => {
    const service = new SlackConnectorService();

    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      mockJsonResponse({ ok: true, team_id: "TAPI", team: "API Team", user_id: "UBOT" })
    );

    const connection = await service.connectApiKey({
      userId: "user-1",
      botToken: "xoxb-api-token",
    });

    expect(connection.authMethod).toBe("api_key");
    expect(connection.teamId).toBe("TAPI");
  });

  it("returns down health when connector is not configured", async () => {
    const service = new SlackConnectorService();
    const health = await service.health("missing-user");

    expect(health.status).toBe("down");
    expect(health.details.auth).toBe(false);
    expect(health.details.errorType).toBe("auth");
  });

  it("refreshes OAuth access token when token is near expiry", async () => {
    const service = new SlackConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          ok: true,
          access_token: "xoxb-old-token",
          refresh_token: "refresh-token-123",
          expires_in: 1,
          scope: "channels:read,chat:write",
          team: { id: "T123", name: "AutoFlow" },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          ok: true,
          access_token: "xoxb-new-token",
          refresh_token: "refresh-token-999",
          expires_in: 3600,
          scope: "channels:read,chat:write",
          team: { id: "T123", name: "AutoFlow" },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({ ok: true, team_id: "T123", team: "AutoFlow", user_id: "UBOT" })
      );

    await service.completeOAuth({ code: "oauth-code", state: start.state });

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const connection = await service.testConnection("user-1");

    expect(connection.teamId).toBe("T123");
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("handles cursor pagination in Slack channel listing", async () => {
    const client = new SlackClient("xoxb-token");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          ok: true,
          channels: [{ id: "C1", name: "general", is_private: false }],
          response_metadata: { next_cursor: "next-page" },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          ok: true,
          channels: [{ id: "C2", name: "alerts", is_private: true }],
          response_metadata: { next_cursor: "" },
        })
      );

    const channels = await client.listConversations(100);
    expect(channels).toHaveLength(2);
    expect(channels[0].id).toBe("C1");
    expect(channels[1].id).toBe("C2");
  });

  it("retries on rate limiting and eventually succeeds", async () => {
    const client = new SlackClient("xoxb-token");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error: "rate_limited" }), {
          status: 429,
          headers: { "Retry-After": "0" },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({ ok: true, team_id: "T123", team: "AutoFlow", user_id: "UBOT" })
      );

    const auth = await client.authTest();
    expect(auth.teamId).toBe("T123");
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(2);
  });

  it("verifies Slack webhook signatures and blocks replay", () => {
    const payload = Buffer.from(JSON.stringify({ type: "event_callback" }), "utf8");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const base = `v0:${timestamp}:${payload.toString("utf8")}`;
    const digest = createHmac("sha256", "signing_secret").update(base).digest("hex");
    const signature = `v0=${digest}`;

    verifySlackSignature({
      rawBody: payload,
      timestampHeader: timestamp,
      signatureHeader: signature,
      signingSecret: "signing_secret",
    });

    expect(() =>
      verifySlackSignature({
        rawBody: payload,
        timestampHeader: timestamp,
        signatureHeader: signature,
        signingSecret: "signing_secret",
      })
    ).toThrow(/replay/i);
  });
});
