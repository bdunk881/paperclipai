import { apolloCredentialStore } from "./credentialStore";
import { ApolloClient } from "./apolloClient";
import { clearOAuthState } from "./oauthStateStore";
import { ApolloConnectorService } from "./service";

function mockJsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

describe("Apollo connector", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      APOLLO_CLIENT_ID: "apollo_client_123",
      APOLLO_CLIENT_SECRET: "apollo_secret_123",
      APOLLO_REDIRECT_URI: "https://autoflow.test/api/integrations/apollo/oauth/callback",
      APOLLO_SCOPES: "read_user_profile contacts_search",
    };

    clearOAuthState();
    apolloCredentialStore.clear();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("builds an OAuth URL with state", () => {
    const service = new ApolloConnectorService();
    const result = service.beginOAuth("user-1");

    expect(result.authUrl).toContain("https://app.apollo.io/#/oauth/authorize");
    expect(result.authUrl).toContain("response_type=code");
    expect(result.authUrl).toContain("scope=read_user_profile+contacts_search");
    expect(result.state).toBeTruthy();
    expect(result.expiresInSeconds).toBeGreaterThan(0);
  });

  it("completes OAuth and stores encrypted credentials", async () => {
    const service = new ApolloConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "apollo_oauth_token",
          refresh_token: "apollo_refresh_token",
          expires_in: 3600,
          scope: "read_user_profile contacts_search",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: "apollo-user-1",
          name: "Ada Apollo",
          email: "ada@example.com",
        })
      );

    const connection = await service.completeOAuth({ code: "oauth-code", state: start.state });

    expect(connection.authMethod).toBe("oauth2");
    expect(connection.accountId).toBe("apollo-user-1");
    expect(connection.accountLabel).toBe("Ada Apollo");
    expect(connection.tokenMasked).toMatch(/^\*{4}/);
  });

  it("connects with API-key fallback and verifies auth", async () => {
    const service = new ApolloConnectorService();

    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      mockJsonResponse({
        authenticated: true,
        api_key_found: true,
      })
    );

    const connection = await service.connectApiKey({
      userId: "user-1",
      apiKey: "apollo_api_key",
    });

    expect(connection.authMethod).toBe("api_key");
    expect(connection.accountId).toBe("apollo-api-key");
  });

  it("returns disabled health when connector is not configured", async () => {
    const service = new ApolloConnectorService();
    const health = await service.health("missing-user");

    expect(health.status).toBe("disabled");
    expect(health.details.auth).toBe(false);
    expect(health.details.errorType).toBe("auth");
  });

  it("refreshes OAuth access token when token is near expiry", async () => {
    const service = new ApolloConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "apollo_old_token",
          refresh_token: "apollo_refresh_token",
          expires_in: 1,
          scope: "read_user_profile",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: "apollo-user-1",
          name: "Ada Apollo",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "apollo_new_token",
          refresh_token: "apollo_refresh_token_2",
          expires_in: 3600,
          scope: "read_user_profile contacts_search",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: "apollo-user-1",
          name: "Ada Apollo",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: "apollo-user-1",
          name: "Ada Apollo",
        })
      );

    await service.completeOAuth({ code: "oauth-code", state: start.state });

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const connection = await service.testConnection("user-1");

    expect(connection.accountId).toBe("apollo-user-1");
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("retries on rate limiting and eventually succeeds", async () => {
    const client = new ApolloClient("apollo_api_key", "api_key");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(mockJsonResponse({ error: "too many requests" }, 429, { "Retry-After": "0" }))
      .mockResolvedValueOnce(
        mockJsonResponse({
          authenticated: true,
          api_key_found: true,
        })
      );

    const viewer = await client.viewer();

    expect(viewer.accountId).toBe("apollo-api-key");
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(2);
  });
});
