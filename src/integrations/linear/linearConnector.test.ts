import { createHmac } from "crypto";
import { linearCredentialStore } from "./credentialStore";
import { LinearClient } from "./linearClient";
import { clearPkceState } from "./pkceStore";
import { LinearConnectorService } from "./service";
import { clearLinearWebhookReplayCache, verifyLinearWebhook } from "./webhook";

function mockJsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

describe("Linear connector", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      LINEAR_CLIENT_ID: "client_123",
      LINEAR_CLIENT_SECRET: "secret_123",
      LINEAR_REDIRECT_URI: "https://autoflow.test/api/integrations/linear/oauth/callback",
      LINEAR_SCOPES: "read,write",
      LINEAR_WEBHOOK_SECRET: "linear_webhook_secret",
    };

    clearPkceState();
    linearCredentialStore.clear();
    clearLinearWebhookReplayCache();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("builds an OAuth URL with PKCE state and challenge", () => {
    const service = new LinearConnectorService();
    const result = service.beginOAuth("user-1");

    expect(result.authUrl).toContain("https://linear.app/oauth/authorize");
    expect(result.authUrl).toContain("code_challenge_method=S256");
    expect(result.state).toBeTruthy();
    expect(result.codeVerifier).toBeTruthy();
    expect(result.expiresInSeconds).toBeGreaterThan(0);
  });

  it("completes OAuth and stores encrypted credentials", async () => {
    const service = new LinearConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "lin_oauth_token",
          refresh_token: "lin_refresh_token",
          expires_in: 3600,
          scope: "read write",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: {
            viewer: {
              id: "viewer-1",
              organization: { id: "org-1", name: "AutoFlow Org" },
            },
          },
        })
      );

    const connection = await service.completeOAuth({ code: "oauth-code", state: start.state });

    expect(connection.authMethod).toBe("oauth2_pkce");
    expect(connection.organizationId).toBe("org-1");
    expect(connection.tokenMasked).toMatch(/^\*{4}/);
  });

  it("connects with API-key fallback and verifies auth", async () => {
    const service = new LinearConnectorService();

    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      mockJsonResponse({
        data: {
          viewer: {
            id: "viewer-api",
            organization: { id: "org-api", name: "API Org" },
          },
        },
      })
    );

    const connection = await service.connectApiKey({
      userId: "user-1",
      apiKey: "lin_api_key",
    });

    expect(connection.authMethod).toBe("api_key");
    expect(connection.organizationId).toBe("org-api");
  });

  it("returns down health when connector is not configured", async () => {
    const service = new LinearConnectorService();
    const health = await service.health("missing-user");

    expect(health.status).toBe("down");
    expect(health.details.auth).toBe(false);
    expect(health.details.errorType).toBe("auth");
  });

  it("refreshes OAuth access token when token is near expiry", async () => {
    const service = new LinearConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "lin_old_token",
          refresh_token: "lin_refresh_token",
          expires_in: 1,
          scope: "read write",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: {
            viewer: {
              id: "viewer-1",
              organization: { id: "org-1", name: "AutoFlow Org" },
            },
          },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "lin_new_token",
          refresh_token: "lin_refresh_token_2",
          expires_in: 3600,
          scope: "read write",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: {
            viewer: {
              id: "viewer-1",
              organization: { id: "org-1", name: "AutoFlow Org" },
            },
          },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: {
            viewer: {
              id: "viewer-1",
              organization: { id: "org-1", name: "AutoFlow Org" },
            },
          },
        })
      );

    await service.completeOAuth({ code: "oauth-code", state: start.state });

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const connection = await service.testConnection("user-1");

    expect(connection.organizationId).toBe("org-1");
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("handles cursor pagination in project and issue listing", async () => {
    const client = new LinearClient("lin_token");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: {
            projects: {
              nodes: [{ id: "p1", name: "Core", state: "started" }],
              pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
            },
          },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: {
            projects: {
              nodes: [{ id: "p2", name: "Growth", state: "planned" }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: {
            issues: {
              nodes: [{ id: "i1", identifier: "ENG-1", title: "First", state: { name: "Todo" } }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        })
      );

    const projects = await client.listProjects(100);
    const issues = await client.listIssues(100);

    expect(projects).toHaveLength(2);
    expect(projects[0].id).toBe("p1");
    expect(issues).toHaveLength(1);
    expect(issues[0].identifier).toBe("ENG-1");
  });

  it("retries on rate limiting and eventually succeeds", async () => {
    const client = new LinearClient("lin_token");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ message: "rate limited" }] }), {
          status: 429,
          headers: { "Retry-After": "0" },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: {
            viewer: {
              id: "viewer-1",
              organization: { id: "org-1", name: "AutoFlow Org" },
            },
          },
        })
      );

    const result = await client.viewer();
    expect(result.organizationId).toBe("org-1");
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });

  it("verifies Linear webhook signatures and blocks replay", () => {
    const payload = Buffer.from(JSON.stringify({ action: "create", type: "Issue" }), "utf8");
    const signature = createHmac("sha256", "linear_webhook_secret").update(payload).digest("hex");

    verifyLinearWebhook({
      rawBody: payload,
      signatureHeader: signature,
      deliveryIdHeader: "delivery-1",
      signingSecret: "linear_webhook_secret",
    });

    expect(() =>
      verifyLinearWebhook({
        rawBody: payload,
        signatureHeader: signature,
        deliveryIdHeader: "delivery-1",
        signingSecret: "linear_webhook_secret",
      })
    ).toThrow("Linear webhook replay detected");
  });
});
