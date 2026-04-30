import express from "express";
import request from "supertest";
import router from "./oauthBridgeRoutes";

jest.mock("../auth/authMiddleware", () => ({
  requireAuth: (
    req: { headers: { authorization?: string }; auth?: { sub: string } },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void
  ) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or malformed Authorization header." });
      return;
    }
    req.auth = { sub: auth.slice(7) };
    next();
  },
}));

const slackBeginOAuth = jest.fn();
const slackCompleteOAuth = jest.fn();
const slackDisconnect = jest.fn();
const linearBeginOAuth = jest.fn();
const linearCompleteOAuth = jest.fn();
const linearDisconnect = jest.fn();
const apolloBeginOAuth = jest.fn();
const apolloCompleteOAuth = jest.fn();
const apolloDisconnect = jest.fn();
const shopifyBeginOAuth = jest.fn();
const shopifyCompleteOAuth = jest.fn();
const shopifyDisconnect = jest.fn();
const docusignBeginOAuth = jest.fn();
const docusignCompleteOAuth = jest.fn();
const docusignDisconnect = jest.fn();
const teamsBeginOAuth = jest.fn();
const teamsCompleteOAuth = jest.fn();
const teamsDisconnect = jest.fn();
const posthogBeginOAuth = jest.fn();
const posthogCompleteOAuth = jest.fn();
const posthogDisconnect = jest.fn();
const intercomBeginOAuth = jest.fn();
const intercomCompleteOAuth = jest.fn();
const intercomDisconnect = jest.fn();
const datadogBeginOAuth = jest.fn();
const datadogCompleteOAuth = jest.fn();
const datadogDisconnect = jest.fn();

const slackGetActiveByUser = jest.fn();
const linearGetActiveByUser = jest.fn();
const apolloGetActiveByUser = jest.fn();
const shopifyGetActiveByUser = jest.fn();
const docusignGetActiveByUser = jest.fn();
const teamsGetActiveByUser = jest.fn();
const posthogGetActiveByUser = jest.fn();
const intercomGetActiveByUser = jest.fn();
const monitoringGetActiveByUserAndProvider = jest.fn();

jest.mock("./slack/service", () => ({
  slackConnectorService: {
    beginOAuth: (...args: unknown[]) => slackBeginOAuth(...args),
    completeOAuth: (...args: unknown[]) => slackCompleteOAuth(...args),
    disconnect: (...args: unknown[]) => slackDisconnect(...args),
  },
}));

jest.mock("./linear/service", () => ({
  linearConnectorService: {
    beginOAuth: (...args: unknown[]) => linearBeginOAuth(...args),
    completeOAuth: (...args: unknown[]) => linearCompleteOAuth(...args),
    disconnect: (...args: unknown[]) => linearDisconnect(...args),
  },
}));

jest.mock("./apollo/service", () => ({
  apolloConnectorService: {
    beginOAuth: (...args: unknown[]) => apolloBeginOAuth(...args),
    completeOAuth: (...args: unknown[]) => apolloCompleteOAuth(...args),
    disconnect: (...args: unknown[]) => apolloDisconnect(...args),
  },
}));

jest.mock("./shopify/service", () => ({
  shopifyConnectorService: {
    beginOAuth: (...args: unknown[]) => shopifyBeginOAuth(...args),
    completeOAuth: (...args: unknown[]) => shopifyCompleteOAuth(...args),
    disconnect: (...args: unknown[]) => shopifyDisconnect(...args),
  },
}));

jest.mock("./docusign/service", () => ({
  docuSignConnectorService: {
    beginOAuth: (...args: unknown[]) => docusignBeginOAuth(...args),
    completeOAuth: (...args: unknown[]) => docusignCompleteOAuth(...args),
    disconnect: (...args: unknown[]) => docusignDisconnect(...args),
  },
}));

jest.mock("./teams/service", () => ({
  teamsConnectorService: {
    beginOAuth: (...args: unknown[]) => teamsBeginOAuth(...args),
    completeOAuth: (...args: unknown[]) => teamsCompleteOAuth(...args),
    disconnect: (...args: unknown[]) => teamsDisconnect(...args),
  },
}));

jest.mock("./posthog/service", () => ({
  posthogConnectorService: {
    beginOAuth: (...args: unknown[]) => posthogBeginOAuth(...args),
    completeOAuth: (...args: unknown[]) => posthogCompleteOAuth(...args),
    disconnect: (...args: unknown[]) => posthogDisconnect(...args),
  },
}));

jest.mock("./intercom/service", () => ({
  intercomConnectorService: {
    beginOAuth: (...args: unknown[]) => intercomBeginOAuth(...args),
    completeOAuth: (...args: unknown[]) => intercomCompleteOAuth(...args),
    disconnect: (...args: unknown[]) => intercomDisconnect(...args),
  },
}));

jest.mock("./datadog-azure-monitor/service", () => ({
  datadogAzureMonitorConnectorService: {
    beginAzureOAuth: (...args: unknown[]) => datadogBeginOAuth(...args),
    completeAzureOAuth: (...args: unknown[]) => datadogCompleteOAuth(...args),
    disconnect: (...args: unknown[]) => datadogDisconnect(...args),
  },
}));

jest.mock("./slack/credentialStore", () => ({
  slackCredentialStore: {
    getActiveByUser: (...args: unknown[]) => slackGetActiveByUser(...args),
  },
}));

jest.mock("./linear/credentialStore", () => ({
  linearCredentialStore: {
    getActiveByUser: (...args: unknown[]) => linearGetActiveByUser(...args),
  },
}));

jest.mock("./apollo/credentialStore", () => ({
  apolloCredentialStore: {
    getActiveByUser: (...args: unknown[]) => apolloGetActiveByUser(...args),
  },
}));

jest.mock("./shopify/credentialStore", () => ({
  shopifyCredentialStore: {
    getActiveByUser: (...args: unknown[]) => shopifyGetActiveByUser(...args),
  },
}));

jest.mock("./docusign/credentialStore", () => ({
  docuSignCredentialStore: {
    getActiveByUser: (...args: unknown[]) => docusignGetActiveByUser(...args),
  },
}));

jest.mock("./teams/credentialStore", () => ({
  teamsCredentialStore: {
    getActiveByUser: (...args: unknown[]) => teamsGetActiveByUser(...args),
  },
}));

jest.mock("./posthog/credentialStore", () => ({
  posthogCredentialStore: {
    getActiveByUser: (...args: unknown[]) => posthogGetActiveByUser(...args),
  },
}));

jest.mock("./intercom/credentialStore", () => ({
  intercomCredentialStore: {
    getActiveByUser: (...args: unknown[]) => intercomGetActiveByUser(...args),
  },
}));

jest.mock("./datadog-azure-monitor/credentialStore", () => ({
  monitoringCredentialStore: {
    getActiveByUserAndProvider: (...args: unknown[]) => monitoringGetActiveByUserAndProvider(...args),
  },
}));

describe("unified oauth bridge routes", () => {
  const app = express();
  app.use(express.json());
  app.use("/api/integrations", router);

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, DASHBOARD_APP_URL: "https://dashboard.autoflow.test" };
    jest.clearAllMocks();
    slackBeginOAuth.mockReturnValue({ authUrl: "https://slack.example/oauth" });
    linearBeginOAuth.mockReturnValue({ authUrl: "https://linear.example/oauth" });
    apolloBeginOAuth.mockReturnValue({ authUrl: "https://apollo.example/oauth" });
    shopifyBeginOAuth.mockReturnValue({ authUrl: "https://shopify.example/oauth" });
    docusignBeginOAuth.mockReturnValue({ authUrl: "https://docusign.example/oauth" });
    teamsBeginOAuth.mockReturnValue({ authUrl: "https://teams.example/oauth" });
    posthogBeginOAuth.mockReturnValue({ authUrl: "https://posthog.example/oauth" });
    intercomBeginOAuth.mockReturnValue({ authUrl: "https://intercom.example/oauth" });
    datadogBeginOAuth.mockReturnValue({ authUrl: "https://azure.example/oauth" });
    slackCompleteOAuth.mockResolvedValue({ id: "conn-1" });
    linearCompleteOAuth.mockResolvedValue({ id: "conn-1" });
    apolloCompleteOAuth.mockResolvedValue({ id: "conn-1" });
    shopifyCompleteOAuth.mockResolvedValue({ id: "conn-1" });
    docusignCompleteOAuth.mockResolvedValue({ id: "conn-1" });
    teamsCompleteOAuth.mockResolvedValue({ id: "conn-1" });
    posthogCompleteOAuth.mockResolvedValue({ id: "conn-1" });
    intercomCompleteOAuth.mockResolvedValue({ id: "conn-1" });
    datadogCompleteOAuth.mockResolvedValue({ id: "conn-1" });
    slackDisconnect.mockReturnValue(true);
    linearDisconnect.mockReturnValue(true);
    apolloDisconnect.mockReturnValue(true);
    shopifyDisconnect.mockReturnValue(true);
    docusignDisconnect.mockReturnValue(true);
    teamsDisconnect.mockReturnValue(true);
    posthogDisconnect.mockReturnValue(true);
    intercomDisconnect.mockReturnValue(true);
    datadogDisconnect.mockReturnValue(true);
    slackGetActiveByUser.mockReturnValue(null);
    linearGetActiveByUser.mockReturnValue(null);
    apolloGetActiveByUser.mockReturnValue(null);
    shopifyGetActiveByUser.mockReturnValue(null);
    docusignGetActiveByUser.mockReturnValue(null);
    teamsGetActiveByUser.mockReturnValue(null);
    posthogGetActiveByUser.mockReturnValue(null);
    intercomGetActiveByUser.mockReturnValue(null);
    monitoringGetActiveByUserAndProvider.mockReturnValue(null);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns redirectUrl for supported providers", async () => {
    const response = await request(app)
      .post("/api/integrations/slack/connect")
      .set("Authorization", "Bearer user-123")
      .send({});

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ redirectUrl: "https://slack.example/oauth" });
    expect(slackBeginOAuth).toHaveBeenCalledWith("user-123");
  });

  it("returns redirectUrl for Apollo connect", async () => {
    const response = await request(app)
      .post("/api/integrations/apollo/connect")
      .set("Authorization", "Bearer user-123")
      .send({});

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ redirectUrl: "https://apollo.example/oauth" });
    expect(apolloBeginOAuth).toHaveBeenCalledWith("user-123");
  });

  it("requires shopDomain for Shopify connect", async () => {
    const response = await request(app)
      .post("/api/integrations/shopify/connect")
      .set("Authorization", "Bearer user-123")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("shopDomain is required for Shopify OAuth");
    expect(shopifyBeginOAuth).not.toHaveBeenCalled();
  });

  it("passes shopDomain to Shopify connect", async () => {
    const response = await request(app)
      .post("/api/integrations/shopify/connect")
      .set("Authorization", "Bearer user-123")
      .send({ shopDomain: "acme.myshopify.com" });

    expect(response.status).toBe(201);
    expect(shopifyBeginOAuth).toHaveBeenCalledWith({
      userId: "user-123",
      shopDomain: "acme.myshopify.com",
    });
    expect(response.body.redirectUrl).toBe("https://shopify.example/oauth");
  });

  it("handles datadog-azure-monitor provider", async () => {
    const response = await request(app)
      .post("/api/integrations/datadog-azure-monitor/connect")
      .set("Authorization", "Bearer user-123")
      .send({});

    expect(response.status).toBe(201);
    expect(datadogBeginOAuth).toHaveBeenCalledWith("user-123");
    expect(response.body.redirectUrl).toBe("https://azure.example/oauth");
  });

  it("redirects unified callback success", async () => {
    const response = await request(app).get(
      "/api/integrations/callback?provider=linear&code=oauth-code&state=oauth-state"
    );

    expect(response.status).toBe(302);
    expect(linearCompleteOAuth).toHaveBeenCalledWith({ code: "oauth-code", state: "oauth-state" });
    expect(response.headers.location).toContain("/integrations");
    expect(response.headers.location).toContain("provider=linear");
    expect(response.headers.location).toContain("status=success");
  });

  it("redirects Apollo callback success", async () => {
    const response = await request(app).get(
      "/api/integrations/callback?provider=apollo&code=oauth-code&state=oauth-state"
    );

    expect(response.status).toBe(302);
    expect(apolloCompleteOAuth).toHaveBeenCalledWith({ code: "oauth-code", state: "oauth-state" });
    expect(response.headers.location).toContain("provider=apollo");
    expect(response.headers.location).toContain("status=success");
  });

  it("redirects unified callback errors from provider", async () => {
    const response = await request(app).get(
      "/api/integrations/callback?provider=slack&error=access_denied&error_description=user_cancelled"
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("provider=slack");
    expect(response.headers.location).toContain("status=error");
    expect(response.headers.location).toContain("Authorization+failed%3A+user_cancelled");
  });

  it("redirects callback failures to error status", async () => {
    teamsCompleteOAuth.mockRejectedValue(new Error("token exchange failed"));

    const response = await request(app).get(
      "/api/integrations/callback?provider=teams&code=oauth-code&state=oauth-state"
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("provider=teams");
    expect(response.headers.location).toContain("status=error");
    expect(response.headers.location).toContain("token+exchange+failed");
  });

  it("passes optional shop query through callback", async () => {
    await request(app).get(
      "/api/integrations/callback?provider=shopify&code=oauth-code&state=oauth-state&shop=acme.myshopify.com"
    );

    expect(shopifyCompleteOAuth).toHaveBeenCalledWith({
      code: "oauth-code",
      state: "oauth-state",
      shop: "acme.myshopify.com",
    });
  });

  it("returns provider status for all registered integrations", async () => {
    slackGetActiveByUser.mockReturnValue({
      id: "slack-1",
      createdAt: "2026-04-18T10:00:00.000Z",
      scopes: ["channels:read", "chat:write"],
    });
    linearGetActiveByUser.mockReturnValue({
      id: "linear-1",
      createdAt: "2026-04-18T12:00:00.000Z",
      scopes: ["issues:read"],
    });
    apolloGetActiveByUser.mockReturnValue({
      id: "apollo-1",
      createdAt: "2026-04-18T12:30:00.000Z",
      scopes: ["contacts:read"],
    });
    monitoringGetActiveByUserAndProvider.mockImplementation((userId: string, provider: string) => {
      if (provider === "datadog") {
        return {
          id: "dd-1",
          createdAt: "2026-04-18T11:00:00.000Z",
          scopes: ["metrics:read"],
        };
      }
      return null;
    });

    const response = await request(app)
      .get("/api/integrations/status")
      .set("Authorization", "Bearer user-123");

    expect(response.status).toBe(200);
    expect(response.body.providers.slack).toEqual({
      connected: true,
      connectedAt: "2026-04-18T10:00:00.000Z",
      scopes: ["channels:read", "chat:write"],
    });
    expect(response.body.providers.linear).toEqual({
      connected: true,
      connectedAt: "2026-04-18T12:00:00.000Z",
      scopes: ["issues:read"],
    });
    expect(response.body.providers.apollo).toEqual({
      connected: true,
      connectedAt: "2026-04-18T12:30:00.000Z",
      scopes: ["contacts:read"],
    });
    expect(response.body.providers.stripe).toEqual({ connected: false });
    expect(response.body.providers["datadog-azure-monitor"]).toEqual({
      connected: true,
      connectedAt: "2026-04-18T11:00:00.000Z",
      scopes: ["metrics:read"],
    });
    expect(response.body.providers.intercom).toEqual({ connected: false });
  });

  it("disconnects a provider by revoking active credential", async () => {
    linearGetActiveByUser.mockReturnValue({
      id: "linear-credential-1",
      createdAt: "2026-04-18T12:00:00.000Z",
      scopes: ["issues:read"],
    });

    const response = await request(app)
      .delete("/api/integrations/linear/disconnect")
      .set("Authorization", "Bearer user-123");

    expect(response.status).toBe(204);
    expect(linearDisconnect).toHaveBeenCalledWith("user-123", "linear-credential-1");
  });

  it("disconnects Apollo by revoking the active credential", async () => {
    apolloGetActiveByUser.mockReturnValue({
      id: "apollo-credential-1",
      createdAt: "2026-04-18T12:00:00.000Z",
      scopes: ["contacts:read"],
    });

    const response = await request(app)
      .delete("/api/integrations/apollo/disconnect")
      .set("Authorization", "Bearer user-123");

    expect(response.status).toBe(204);
    expect(apolloDisconnect).toHaveBeenCalledWith("user-123", "apollo-credential-1");
  });

  it("returns 204 for disconnect when the provider has no active credential", async () => {
    linearGetActiveByUser.mockReturnValue(null);

    const response = await request(app)
      .delete("/api/integrations/linear/disconnect")
      .set("Authorization", "Bearer user-123");

    expect(response.status).toBe(204);
    expect(linearDisconnect).not.toHaveBeenCalled();
  });

  it("disconnects datadog-azure-monitor by revoking both provider credentials when present", async () => {
    monitoringGetActiveByUserAndProvider.mockImplementation((userId: string, provider: string) => {
      if (provider === "datadog") {
        return { id: "dd-1", createdAt: "2026-04-18T10:00:00.000Z", scopes: ["metrics:read"] };
      }
      if (provider === "azure_monitor") {
        return { id: "az-1", createdAt: "2026-04-18T09:00:00.000Z", scopes: ["user_impersonation"] };
      }
      return null;
    });

    const response = await request(app)
      .delete("/api/integrations/datadog-azure-monitor/disconnect")
      .set("Authorization", "Bearer user-123");

    expect(response.status).toBe(204);
    expect(datadogDisconnect).toHaveBeenCalledWith("user-123", "dd-1");
    expect(datadogDisconnect).toHaveBeenCalledWith("user-123", "az-1");
  });
});
