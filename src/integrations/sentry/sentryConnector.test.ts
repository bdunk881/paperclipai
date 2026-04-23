import { createHmac } from "crypto";
import { SentryClient } from "./sentryClient";
import { sentryCredentialStore } from "./credentialStore";
import { clearPkceState } from "./pkceStore";
import { SentryConnectorService } from "./service";
import { clearSentryWebhookReplayCache, verifySentryWebhook } from "./webhook";

function mockJsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

describe("Sentry connector", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SENTRY_CLIENT_ID: "sentry_client_123",
      SENTRY_CLIENT_SECRET: "sentry_secret_123",
      SENTRY_REDIRECT_URI: "https://autoflow.test/api/integrations/sentry/oauth/callback",
      SENTRY_SCOPES: "org:read project:read event:read",
    };

    clearPkceState();
    sentryCredentialStore.clear();
    clearSentryWebhookReplayCache();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("builds an OAuth URL with PKCE state", () => {
    const service = new SentryConnectorService();
    const result = service.beginOAuth("user-1");

    expect(result.authUrl).toContain("https://sentry.io/oauth/authorize/");
    expect(result.authUrl).toContain("response_type=code");
    expect(result.authUrl).toContain("org%3Aread");
    expect(result.state).toBeTruthy();
    expect(result.codeVerifier).toBeTruthy();
    expect(result.expiresInSeconds).toBeGreaterThan(0);
  });

  it("completes OAuth and stores encrypted credentials", async () => {
    const service = new SentryConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "sentry_oauth_token",
          refresh_token: "sentry_refresh_token",
          expires_in: 3600,
          scope: "org:read project:read event:read",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse([
          {
            id: "org-1",
            slug: "autoflow",
            name: "AutoFlow",
          },
        ])
      );

    const connection = await service.completeOAuth({ code: "oauth-code", state: start.state });

    expect(connection.authMethod).toBe("oauth2_pkce");
    expect(connection.organizationSlug).toBe("autoflow");
    expect(connection.organizationName).toBe("AutoFlow");
    expect(connection.tokenMasked).toMatch(/^\*{4}/);
  });

  it("connects with API key fallback using basic auth", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValueOnce(
      mockJsonResponse([
        {
          id: "org-777",
          slug: "private-acme",
          name: "Private Acme",
        },
      ])
    );

    const service = new SentryConnectorService();
    const connection = await service.connectApiKey({
      userId: "user-1",
      apiKey: "sentry_api_key",
    });

    expect(connection.authMethod).toBe("api_key");
    expect(connection.organizationSlug).toBe("private-acme");
    expect(fetchSpy.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from("sentry_api_key:", "utf8").toString("base64")}`,
    });
  });

  it("returns down health when connector is not configured", async () => {
    const service = new SentryConnectorService();
    const health = await service.health("missing-user");

    expect(health.status).toBe("down");
    expect(health.details.auth).toBe(false);
    expect(health.details.errorType).toBe("auth");
  });

  it("refreshes an OAuth credential when it is near expiry", async () => {
    const service = new SentryConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "sentry_old_token",
          refresh_token: "sentry_refresh_token",
          expires_in: 1,
          scope: "org:read project:read",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse([
          {
            id: "org-1",
            slug: "autoflow",
            name: "AutoFlow",
          },
        ])
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "sentry_new_token",
          refresh_token: "sentry_refresh_token_2",
          expires_in: 3600,
          scope: "org:read project:read event:read",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse([
          {
            id: "org-1",
            slug: "autoflow",
            name: "AutoFlow",
          },
        ])
      )
      .mockResolvedValueOnce(
        mockJsonResponse([
          {
            id: "org-1",
            slug: "autoflow",
            name: "AutoFlow",
          },
        ])
      );

    await service.completeOAuth({ code: "oauth-code", state: start.state });
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const result = await service.testConnection("user-1");

    expect(result.organizationSlug).toBe("autoflow");
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("handles Link-header pagination for project and issue queries", async () => {
    const client = new SentryClient("sentry_oauth_token", "oauth2_pkce");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse(
          [
            { id: "1", slug: "frontend", name: "Frontend", platform: "javascript" },
          ],
          200,
          {
            Link: '<https://sentry.io/api/0/organizations/autoflow/projects/?cursor=cursor-1>; rel="next"; results="true"; cursor="cursor-1"',
          }
        )
      )
      .mockResolvedValueOnce(
        mockJsonResponse([
          { id: "2", slug: "backend", name: "Backend", platform: "node" },
        ])
      )
      .mockResolvedValueOnce(
        mockJsonResponse(
          [
            { id: "10", shortId: "AUTOFLOW-10", title: "First issue", status: "unresolved" },
          ],
          200,
          {
            Link: '<https://sentry.io/api/0/organizations/autoflow/issues/?cursor=cursor-2>; rel="next"; results="true"; cursor="cursor-2"',
          }
        )
      )
      .mockResolvedValueOnce(
        mockJsonResponse([
          { id: "11", shortId: "AUTOFLOW-11", title: "Second issue", status: "resolved" },
        ])
      );

    const projects = await client.listProjects("autoflow", 100);
    const issues = await client.listIssues({ organizationSlug: "autoflow", limit: 100 });

    expect(projects).toHaveLength(2);
    expect(projects[1].slug).toBe("backend");
    expect(issues).toHaveLength(2);
    expect(issues[1].shortId).toBe("AUTOFLOW-11");
  });

  it("retries on rate limiting and eventually succeeds", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(mockJsonResponse({ detail: "rate limited" }, 429, { "Retry-After": "0" }))
      .mockResolvedValueOnce(
        mockJsonResponse([
          {
            id: "org-1",
            slug: "autoflow",
            name: "AutoFlow",
          },
        ])
      );

    const client = new SentryClient("sentry_oauth_token", "oauth2_pkce");
    const viewer = await client.viewer();

    expect(viewer.organizationSlug).toBe("autoflow");
    expect(fetchSpy.mock.calls).toHaveLength(2);
  });

  it("validates webhook signatures and blocks replayed events", () => {
    const rawBody = Buffer.from(JSON.stringify({ action: "issue.created" }), "utf8");
    const signature = createHmac("sha256", "sentry_secret_123")
      .update(rawBody)
      .digest("hex");

    expect(() => verifySentryWebhook({
      rawBody,
      signatureHeader: signature,
      hookIdHeader: "hook-1",
      resourceHeader: "issue",
      eventIdHeader: "evt-1",
      sentryClientSecret: "sentry_secret_123",
    })).not.toThrow();

    expect(() => verifySentryWebhook({
      rawBody,
      signatureHeader: signature,
      hookIdHeader: "hook-1",
      resourceHeader: "issue",
      eventIdHeader: "evt-1",
      sentryClientSecret: "sentry_secret_123",
    })).toThrow(/replay/i);
  });
});
