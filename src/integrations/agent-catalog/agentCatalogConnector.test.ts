import { agentCatalogCredentialStore } from "./credentialStore";
import { clearPkceState } from "./pkceStore";
import { AgentCatalogConnectorService } from "./service";

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Agent catalog OAuth connector", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      AGENT_CATALOG_GOOGLE_CLIENT_ID: "google-client",
      AGENT_CATALOG_GOOGLE_CLIENT_SECRET: "google-secret",
      AGENT_CATALOG_GOOGLE_REDIRECT_URI: "https://autoflow.test/api/integrations/agent-catalog/google/oauth/callback",
      AGENT_CATALOG_GITHUB_CLIENT_ID: "github-client",
      AGENT_CATALOG_GITHUB_CLIENT_SECRET: "github-secret",
      AGENT_CATALOG_GITHUB_REDIRECT_URI: "https://autoflow.test/api/integrations/agent-catalog/github/oauth/callback",
      AGENT_CATALOG_NOTION_CLIENT_ID: "notion-client",
      AGENT_CATALOG_NOTION_CLIENT_SECRET: "notion-secret",
      AGENT_CATALOG_NOTION_REDIRECT_URI: "https://autoflow.test/api/integrations/agent-catalog/notion/oauth/callback",
    };

    clearPkceState();
    agentCatalogCredentialStore.clear();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("builds provider authorization URL with state and PKCE challenge", () => {
    const service = new AgentCatalogConnectorService();
    const flow = service.beginOAuth("user-1", "github");

    expect(flow.authUrl).toContain("https://github.com/login/oauth/authorize");
    expect(flow.authUrl).toContain("state=");
    expect(flow.authUrl).toContain("code_challenge=");
    expect(flow.authUrl).toContain("code_challenge_method=S256");
  });

  it("only marks connected after token exchange and provider verification succeed", async () => {
    const service = new AgentCatalogConnectorService();
    const flow = service.beginOAuth("user-1", "google");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "google-access-token",
          refresh_token: "google-refresh-token",
          scope: "openid email profile",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          email: "integrations@autoflow.test",
        })
      );

    const connection = await service.completeOAuth({
      provider: "google",
      code: "oauth-code",
      state: flow.state,
    });

    expect(connection.provider).toBe("google");
    expect(connection.accountLabel).toBe("integrations@autoflow.test");
    expect(connection.tokenMasked).toMatch(/^\*{4}/);

    const stored = service.listConnections("user-1");
    expect(stored).toHaveLength(1);
    expect(stored[0].provider).toBe("google");
  });

  it("does not report success when provider verification fails", async () => {
    const service = new AgentCatalogConnectorService();
    const flow = service.beginOAuth("user-1", "github");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "gh-access-token",
          scope: "read:user,user:email",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({ message: "Bad credentials" }, 401)
      );

    await expect(
      service.completeOAuth({
        provider: "github",
        code: "oauth-code",
        state: flow.state,
      })
    ).rejects.toThrow(/verification failed/i);

    expect(service.listConnections("user-1")).toHaveLength(0);
  });
});
