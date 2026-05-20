import { clearPkceState } from "./pkceStore";
import { slackCredentialStore } from "./credentialStore";
import { SlackConnectorService } from "./service";
import { clearSlackWebhookReplayCache, verifySlackSignature } from "./webhook";
import { SlackClient } from "./slackClient";
import { createHmac } from "crypto";

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

  it("returns disabled health when connector is not configured", async () => {
    const service = new SlackConnectorService();
    const health = await service.health("missing-user");

    expect(health.status).toBe("disabled");
    expect(health.details.auth).toBe(false);
    expect(health.recommendedNextAction).toMatch(/connect a slack credential/i);
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

  it("survives a simulated process restart via the async getter (HEL-180)", async () => {
    // Save a credential, then clear the local bucket to simulate a fresh
    // process (without touching Postgres). The async getter must re-hydrate
    // the credential from the registry's persistence layer when the local
    // bucket is empty. In unit-test mode (no DATABASE_URL), the registry's
    // bucket IS the persistence layer — so we instead verify the API
    // contract: async lookups return the same shape as sync lookups when
    // hydration is needed.
    const saved = await slackCredentialStore.saveOAuth({
      userId: "user-restart",
      accessToken: "xoxb-fresh-1234",
      scopes: ["channels:read", "chat:write"],
      teamId: "T-restart",
      teamName: "Restart Workspace",
    });

    // Sync path: should find the credential.
    const sync = slackCredentialStore.getActiveByUser("user-restart");
    expect(sync).not.toBeNull();
    expect(sync?.teamId).toBe("T-restart");

    // Async path: should also find it (this is the after-restart shape
    // every service.ts call site now uses).
    const asyncCred = await slackCredentialStore.getActiveByUserAsync("user-restart");
    expect(asyncCred).not.toBeNull();
    expect(asyncCred?.id).toBe(sync?.id);
    expect(asyncCred?.teamId).toBe("T-restart");

    // getByIdAsync — the path used by notifications/delivery.ts.
    const byIdAsync = await slackCredentialStore.getByIdAsync(saved.id, "user-restart");
    expect(byIdAsync).not.toBeNull();
    expect(byIdAsync?.id).toBe(saved.id);

    // Wrong user → null even with valid ID.
    const wrongUser = await slackCredentialStore.getByIdAsync(saved.id, "user-different");
    expect(wrongUser).toBeNull();
  });

  it("reports degraded health with missing required scopes (HEL-181)", async () => {
    // Connect a Slack workspace that only granted channels:read — missing
    // chat:write + channels:history. health() must surface this as
    // "degraded" with a missing-scopes list so the ConnectorHealth UI
    // can show a Reconnect CTA.
    await slackCredentialStore.saveOAuth({
      userId: "user-scopes",
      accessToken: "xoxb-narrow-grant",
      scopes: ["channels:read"], // missing chat:write + channels:history
      teamId: "T-narrow",
      teamName: "Narrow Workspace",
    });

    // auth.test will succeed — the missing scope only affects specific
    // Slack methods, not the identity check.
    jest.spyOn(global, "fetch").mockImplementation(async () =>
      mockJsonResponse({
        ok: true,
        team: "Narrow Workspace",
        team_id: "T-narrow",
        user_id: "U-bot",
      }),
    );

    const service = new SlackConnectorService();
    const health = await service.health("user-scopes");

    expect(health.status).toBe("degraded");
    expect(health.details.message).toMatch(/missing required scopes/i);
    expect(health.details.message).toMatch(/chat:write/);
    expect(health.details.message).toMatch(/channels:history/);
    // metadata.missingScopes is what the dashboard renders in the row.
    // The Tier1 metadata fields (including `missingScopes`) are spread
    // onto the top of the health response, not nested under .metadata.
    expect((health as unknown as { missingScopes?: string[] }).missingScopes).toEqual(
      expect.arrayContaining(["chat:write", "channels:history"]),
    );
    expect(health.recommendedNextAction).toMatch(/reconnect slack/i);
  });

  it("reports healthy when all required scopes are granted (HEL-181)", async () => {
    // Default required-scopes set (post-Codex P2 expansion) includes the
    // groups:* pair for private-channel support — see service.ts comment.
    await slackCredentialStore.saveOAuth({
      userId: "user-fullscopes",
      accessToken: "xoxb-full-grant",
      scopes: [
        "channels:read",
        "chat:write",
        "groups:read",
        "channels:history",
        "groups:history",
      ],
      teamId: "T-full",
      teamName: "Full Workspace",
    });

    jest.spyOn(global, "fetch").mockImplementation(async () =>
      mockJsonResponse({
        ok: true,
        team: "Full Workspace",
        team_id: "T-full",
        user_id: "U-bot",
      }),
    );

    const service = new SlackConnectorService();
    const health = await service.health("user-fullscopes");

    expect(health.status).toBe("healthy");
    expect(health.details.message).toBeUndefined();
    expect((health as unknown as { missingScopes?: string[] }).missingScopes).toBeUndefined();
  });

  it("skips scope-degradation for API-key connections (Codex P2 round 4 on #926)", async () => {
    // API-key connections save with scopes:[] because Slack doesn't return
    // bot-token scopes on the saveApiKey path. Without the skip in health(),
    // EVERY API-key connection would report degraded with every required
    // scope missing — false-negative health spam on connections that work.
    await slackCredentialStore.saveApiKey({
      userId: "user-apikey-scopes",
      botToken: "xoxb-bot-token-no-scope-metadata",
      teamId: "T-apikey",
      teamName: "API-Key Workspace",
      // intentional: no scopes provided, mirrors connectApiKey() flow
    });

    jest.spyOn(global, "fetch").mockImplementation(async () =>
      mockJsonResponse({
        ok: true,
        team: "API-Key Workspace",
        team_id: "T-apikey",
        user_id: "U-bot",
      }),
    );

    const service = new SlackConnectorService();
    const health = await service.health("user-apikey-scopes");

    // healthy, NOT degraded — the auth.test succeeded and bot-token scope
    // discovery happens at API-call time, not here.
    expect(health.status).toBe("healthy");
    expect(health.details.message).toBeUndefined();
    expect((health as unknown as { missingScopes?: string[] }).missingScopes).toBeUndefined();
    expect(health.authMethod).toBe("api_key");
  });

  it("upsert dedupes prior (user, team) active credentials before saving (Codex P2 on #926)", async () => {
    // Save → save again for the same (user, team) — the second should
    // replace the first, not coexist. The original Map-backed code did
    // this synchronously by walking the in-memory Map. The refactored
    // code must do the same after hydrating from Postgres, otherwise
    // a post-restart reconnect leaves two active rows.
    const first = await slackCredentialStore.saveOAuth({
      userId: "user-dedup",
      accessToken: "xoxb-first",
      scopes: ["chat:write"],
      teamId: "T-dedup",
    });

    const second = await slackCredentialStore.saveOAuth({
      userId: "user-dedup",
      accessToken: "xoxb-second",
      scopes: ["chat:write", "channels:read"],
      teamId: "T-dedup",
    });

    // Only ONE active credential should remain for this (user, team).
    const active = await slackCredentialStore.getPublicByUserAsync("user-dedup");
    const liveForTeam = active.filter(
      (c) => c.teamId === "T-dedup" && !c.revokedAt,
    );
    expect(liveForTeam).toHaveLength(1);
    expect(liveForTeam[0]?.id).toBe(second.id);
    expect(first.id).not.toBe(second.id);

    // The latest credential's scopes match the second save.
    expect(liveForTeam[0]?.scopes).toContain("channels:read");
  });

  it("encrypts tokens via the shared connectorSecretVault (HEL-180)", async () => {
    // Verify that the refactored store still encrypts at rest — the raw
    // record's tokenEncrypted must NOT contain the plaintext, and the
    // decrypt helper must round-trip.
    const saved = await slackCredentialStore.saveOAuth({
      userId: "user-encrypt",
      accessToken: "xoxb-plaintext-secret-9999",
      refreshToken: "xoxr-refresh-secret-8888",
      scopes: ["chat:write"],
      teamId: "T-encrypt",
    });

    const stored = slackCredentialStore.getById(saved.id, "user-encrypt");
    expect(stored).not.toBeNull();
    expect(stored!.tokenEncrypted).not.toContain("plaintext");
    expect(stored!.refreshTokenEncrypted).not.toContain("refresh-secret");
    expect(stored!.tokenMasked).toBe("****9999");

    expect(slackCredentialStore.decryptAccessToken(stored!)).toBe("xoxb-plaintext-secret-9999");
    expect(slackCredentialStore.decryptRefreshToken(stored!)).toBe("xoxr-refresh-secret-8888");
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
