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

const apolloBeginOAuth = jest.fn();
const apolloCompleteOAuth = jest.fn();
const apolloDisconnect = jest.fn();
const gmailBeginOAuth = jest.fn();
const gmailCompleteOAuth = jest.fn();
const gmailDisconnect = jest.fn();
const hubspotBeginOAuth = jest.fn();
const hubspotCompleteOAuth = jest.fn();
const hubspotDisconnect = jest.fn();
const sentryBeginOAuth = jest.fn();
const sentryCompleteOAuth = jest.fn();
const sentryDisconnect = jest.fn();
const slackBeginOAuth = jest.fn();
const slackCompleteOAuth = jest.fn();
const slackDisconnect = jest.fn();
const stripeBeginOAuth = jest.fn();
const stripeCompleteOAuth = jest.fn();
const stripeDisconnect = jest.fn();
const composioDisconnect = jest.fn();

const apolloGetActiveByUserAsync = jest.fn();
const gmailGetActiveByUserAsync = jest.fn();
const hubspotGetActiveByUserAsync = jest.fn();
const sentryGetActiveByUserAsync = jest.fn();
const slackGetActiveByUserAsync = jest.fn();
const stripeGetActiveByUserAsync = jest.fn();
const composioGetActiveByUserAsync = jest.fn();

jest.mock("./apollo/service", () => ({
  apolloConnectorService: {
    beginOAuth: (...args: unknown[]) => apolloBeginOAuth(...args),
    completeOAuth: (...args: unknown[]) => apolloCompleteOAuth(...args),
    disconnect: (...args: unknown[]) => apolloDisconnect(...args),
  },
}));

jest.mock("./gmail/service", () => ({
  gmailConnectorService: {
    beginOAuth: (...args: unknown[]) => gmailBeginOAuth(...args),
    completeOAuth: (...args: unknown[]) => gmailCompleteOAuth(...args),
    disconnect: (...args: unknown[]) => gmailDisconnect(...args),
  },
}));

jest.mock("./hubspot/service", () => ({
  hubSpotConnectorService: {
    beginOAuth: (...args: unknown[]) => hubspotBeginOAuth(...args),
    completeOAuth: (...args: unknown[]) => hubspotCompleteOAuth(...args),
    disconnect: (...args: unknown[]) => hubspotDisconnect(...args),
  },
}));

jest.mock("./sentry/service", () => ({
  sentryConnectorService: {
    beginOAuth: (...args: unknown[]) => sentryBeginOAuth(...args),
    completeOAuth: (...args: unknown[]) => sentryCompleteOAuth(...args),
    disconnect: (...args: unknown[]) => sentryDisconnect(...args),
  },
}));

jest.mock("./slack/service", () => ({
  slackConnectorService: {
    beginOAuth: (...args: unknown[]) => slackBeginOAuth(...args),
    completeOAuth: (...args: unknown[]) => slackCompleteOAuth(...args),
    disconnect: (...args: unknown[]) => slackDisconnect(...args),
  },
}));

jest.mock("./stripe/service", () => ({
  stripeConnectorService: {
    beginOAuth: (...args: unknown[]) => stripeBeginOAuth(...args),
    completeOAuth: (...args: unknown[]) => stripeCompleteOAuth(...args),
    disconnect: (...args: unknown[]) => stripeDisconnect(...args),
  },
}));

jest.mock("./composio/service", () => ({
  composioConnectorService: {
    disconnect: (...args: unknown[]) => composioDisconnect(...args),
  },
}));

jest.mock("./apollo/credentialStore", () => ({
  apolloCredentialStore: {
    getActiveByUserAsync: (...args: unknown[]) => apolloGetActiveByUserAsync(...args),
  },
}));

jest.mock("./gmail/credentialStore", () => ({
  gmailCredentialStore: {
    getActiveByUserAsync: (...args: unknown[]) => gmailGetActiveByUserAsync(...args),
  },
}));

jest.mock("./hubspot/credentialStore", () => ({
  hubSpotCredentialStore: {
    getActiveByUserAsync: (...args: unknown[]) => hubspotGetActiveByUserAsync(...args),
  },
}));

jest.mock("./sentry/credentialStore", () => ({
  sentryCredentialStore: {
    getActiveByUserAsync: (...args: unknown[]) => sentryGetActiveByUserAsync(...args),
  },
}));

jest.mock("./slack/credentialStore", () => ({
  slackCredentialStore: {
    getActiveByUserAsync: (...args: unknown[]) => slackGetActiveByUserAsync(...args),
  },
}));

jest.mock("./stripe/credentialStore", () => ({
  stripeCredentialStore: {
    getActiveByUserAsync: (...args: unknown[]) => stripeGetActiveByUserAsync(...args),
  },
}));

jest.mock("./composio/credentialStore", () => ({
  composioCredentialStore: {
    getActiveByUserAsync: (...args: unknown[]) => composioGetActiveByUserAsync(...args),
  },
}));

describe("oauth bridge routes", () => {
  const app = express();
  app.use(express.json());
  app.use("/api/integrations", router);

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, DASHBOARD_APP_URL: "https://dashboard.autoflow.test" };
    jest.clearAllMocks();

    apolloBeginOAuth.mockReturnValue({ authUrl: "https://apollo.example/oauth" });
    gmailBeginOAuth.mockReturnValue({ authUrl: "https://gmail.example/oauth" });
    hubspotBeginOAuth.mockReturnValue({ authUrl: "https://hubspot.example/oauth" });
    sentryBeginOAuth.mockReturnValue({ authUrl: "https://sentry.example/oauth" });
    slackBeginOAuth.mockReturnValue({ authUrl: "https://slack.example/oauth" });
    stripeBeginOAuth.mockReturnValue({ authUrl: "https://stripe.example/oauth" });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns redirectUrl for a supported provider", async () => {
    const response = await request(app)
      .post("/api/integrations/slack/connect")
      .set("Authorization", "Bearer user-123")
      .send({});

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ redirectUrl: "https://slack.example/oauth" });
    expect(slackBeginOAuth).toHaveBeenCalledWith("user-123");
  });

  it("returns status across registered providers", async () => {
    apolloGetActiveByUserAsync.mockResolvedValue({
      id: "apollo-1",
      createdAt: "2026-04-21T20:00:00.000Z",
      scopes: ["read_user_profile"],
    });
    gmailGetActiveByUserAsync.mockResolvedValue({
      id: "gmail-1",
      createdAt: "2026-04-21T20:30:00.000Z",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    });
    slackGetActiveByUserAsync.mockResolvedValue({
      id: "slack-1",
      createdAt: "2026-04-21T21:00:00.000Z",
      scopes: ["channels:read", "chat:write"],
    });
    composioGetActiveByUserAsync.mockResolvedValue({
      id: "composio-1",
      createdAt: "2026-04-21T22:00:00.000Z",
    });
    hubspotGetActiveByUserAsync.mockResolvedValue(null);
    sentryGetActiveByUserAsync.mockResolvedValue(null);
    stripeGetActiveByUserAsync.mockResolvedValue(null);

    const response = await request(app)
      .get("/api/integrations/status")
      .set("Authorization", "Bearer user-123");

    expect(response.status).toBe(200);
    expect(response.body.providers.slack).toEqual({
      connected: true,
      connectedAt: "2026-04-21T21:00:00.000Z",
      scopes: ["channels:read", "chat:write"],
    });
    expect(response.body.providers.apollo).toEqual({
      connected: true,
      connectedAt: "2026-04-21T20:00:00.000Z",
      scopes: ["read_user_profile"],
    });
    expect(response.body.providers.gmail).toEqual({
      connected: true,
      connectedAt: "2026-04-21T20:30:00.000Z",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    });
    expect(response.body.providers.composio).toEqual({
      connected: true,
      connectedAt: "2026-04-21T22:00:00.000Z",
    });
    expect(response.body.providers.stripe).toEqual({ connected: false });
  });

  it("redirects callback success to the dashboard integrations page", async () => {
    slackCompleteOAuth.mockResolvedValue({ id: "conn-1" });

    const response = await request(app).get(
      "/api/integrations/callback?provider=slack&code=oauth-code&state=oauth-state"
    );

    expect(response.status).toBe(302);
    expect(slackCompleteOAuth).toHaveBeenCalledWith({ code: "oauth-code", state: "oauth-state" });
    expect(response.headers.location).toContain("/integrations");
    expect(response.headers.location).toContain("provider=slack");
    expect(response.headers.location).toContain("status=success");
  });

  it("redirects callback failures to error status", async () => {
    slackCompleteOAuth.mockRejectedValue(new Error("token exchange failed"));

    const response = await request(app).get(
      "/api/integrations/callback?provider=slack&code=oauth-code&state=oauth-state"
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("provider=slack");
    expect(response.headers.location).toContain("status=error");
    expect(response.headers.location).toContain("token+exchange+failed");
  });

  it("disconnects the current Slack credential", async () => {
    slackGetActiveByUserAsync.mockResolvedValue({
      id: "slack-credential-1",
      createdAt: "2026-04-21T21:00:00.000Z",
      scopes: ["channels:read"],
    });

    const response = await request(app)
      .delete("/api/integrations/slack/disconnect")
      .set("Authorization", "Bearer user-123");

    expect(response.status).toBe(204);
    expect(slackDisconnect).toHaveBeenCalledWith("user-123", "slack-credential-1");
  });

  it("disconnects the current Gmail credential", async () => {
    gmailGetActiveByUserAsync.mockResolvedValue({
      id: "gmail-credential-1",
      createdAt: "2026-04-21T21:30:00.000Z",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    });

    const response = await request(app)
      .delete("/api/integrations/gmail/disconnect")
      .set("Authorization", "Bearer user-123");

    expect(response.status).toBe(204);
    expect(gmailDisconnect).toHaveBeenCalledWith("user-123", "gmail-credential-1");
  });
});
