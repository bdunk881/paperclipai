import { createHash } from "crypto";
import { teamsCredentialStore } from "./credentialStore";
import { clearPkceState } from "./pkceStore";
import { TeamsConnectorService } from "./service";
import { clearTeamsWebhookReplayCache, verifyTeamsWebhook } from "./webhook";
import { TeamsClient } from "./teamsClient";

function mockJsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

describe("Microsoft Teams connector", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TEAMS_CLIENT_ID: "teams_client_123",
      TEAMS_CLIENT_SECRET: "teams_secret_123",
      TEAMS_REDIRECT_URI: "https://autoflow.test/api/integrations/teams/oauth/callback",
      TEAMS_SCOPES: "openid profile offline_access User.Read Chat.Read ChannelMessage.Read.All",
      TEAMS_TENANT_ID: "common",
      TEAMS_WEBHOOK_CLIENT_STATE: "teams_client_state_secret",
    };

    clearPkceState();
    teamsCredentialStore.clear();
    clearTeamsWebhookReplayCache();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("builds an OAuth URL with PKCE state and challenge", () => {
    const service = new TeamsConnectorService();
    const result = service.beginOAuth("user-1");

    expect(result.authUrl).toContain("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(result.authUrl).toContain("code_challenge_method=S256");
    expect(result.state).toBeTruthy();
    expect(result.codeVerifier).toBeTruthy();
    expect(result.expiresInSeconds).toBeGreaterThan(0);
  });

  it("completes OAuth and stores encrypted credentials", async () => {
    const service = new TeamsConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "teams_oauth_token",
          refresh_token: "teams_refresh_token",
          expires_in: 3600,
          scope: "User.Read Chat.Read",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: "user-graph-1",
          displayName: "Alex User",
          userPrincipalName: "alex@example.com",
        })
      );

    const connection = await service.completeOAuth({ code: "oauth-code", state: start.state });

    expect(connection.authMethod).toBe("oauth2_pkce");
    expect(connection.accountId).toBe("user-graph-1");
    expect(connection.tokenMasked).toMatch(/^\*{4}/);
  });

  it("connects with API-key fallback and verifies auth", async () => {
    const service = new TeamsConnectorService();

    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      mockJsonResponse({
        id: "user-api-1",
        displayName: "API User",
        userPrincipalName: "api@example.com",
      })
    );

    const connection = await service.connectApiKey({
      userId: "user-1",
      apiKey: "teams_api_key",
    });

    expect(connection.authMethod).toBe("api_key");
    expect(connection.accountId).toBe("user-api-1");
  });

  it("returns disabled health when connector is not configured", async () => {
    const service = new TeamsConnectorService();
    const health = await service.health("missing-user");

    expect(health.status).toBe("disabled");
    expect(health.details.auth).toBe(false);
    expect(health.recommendedNextAction).toMatch(/connect a microsoft teams credential/i);
  });

  it("refreshes OAuth access token when token is near expiry", async () => {
    const service = new TeamsConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "teams_old_token",
          refresh_token: "teams_refresh_token",
          expires_in: 1,
          scope: "User.Read Chat.Read",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: "user-graph-1",
          displayName: "Alex User",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "teams_new_token",
          refresh_token: "teams_refresh_token_2",
          expires_in: 3600,
          scope: "User.Read Chat.Read",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: "user-graph-1",
          displayName: "Alex User",
        })
      );

    await service.completeOAuth({ code: "oauth-code", state: start.state });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const connection = await service.testConnection("user-1");

    expect(connection.accountId).toBe("user-graph-1");
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("handles pagination in teams and channel message listing", async () => {
    const client = new TeamsClient("teams_token");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          value: [{ id: "team-1", displayName: "Core Team" }],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/joinedTeams?$skiptoken=abc",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          value: [{ id: "team-2", displayName: "Growth Team" }],
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          value: [{ id: "m1", summary: "First" }],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages?$skiptoken=def",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          value: [{ id: "m2", summary: "Second" }],
        })
      );

    const teams = await client.listTeams();
    const messages = await client.listChannelMessages("team-1", "channel-1");

    expect(teams).toHaveLength(2);
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe("m1");
  });

  it("retries on rate limiting and eventually succeeds", async () => {
    const client = new TeamsClient("teams_token");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Too Many Requests" } }), {
          status: 429,
          headers: { "Retry-After": "0" },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: "user-graph-1",
          displayName: "Alex User",
        })
      );

    const me = await client.me();
    expect(me.id).toBe("user-graph-1");
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });

  it("verifies Teams webhook clientState and blocks replay", () => {
    const digestA = createHash("sha256").update("teams_client_state_secret").digest("hex");
    const digestB = createHash("sha256").update("teams_client_state_secret").digest("hex");
    expect(digestA).toBe(digestB);

    verifyTeamsWebhook({
      notifications: [
        {
          id: "notif-1",
          subscriptionId: "sub-1",
          clientState: "teams_client_state_secret",
          resource: "/teams('1')",
          changeType: "updated",
        },
      ],
      expectedClientState: "teams_client_state_secret",
    });

    expect(() =>
      verifyTeamsWebhook({
        notifications: [
          {
            id: "notif-1",
            subscriptionId: "sub-1",
            clientState: "teams_client_state_secret",
          },
        ],
        expectedClientState: "teams_client_state_secret",
      })
    ).toThrow("Teams webhook replay detected");
  });
});
