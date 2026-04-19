import express from "express";
import request from "supertest";
import router from "./routes";
import { AgentCatalogConnectorError } from "./types";

jest.mock("../../auth/authMiddleware", () => ({
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

const completeOAuth = jest.fn();
const beginOAuth = jest.fn();
const listConnections = jest.fn();
const testConnection = jest.fn();
const disconnect = jest.fn();

jest.mock("./service", () => ({
  agentCatalogConnectorService: {
    completeOAuth: (...args: unknown[]) => completeOAuth(...args),
    beginOAuth: (...args: unknown[]) => beginOAuth(...args),
    listConnections: (...args: unknown[]) => listConnections(...args),
    testConnection: (...args: unknown[]) => testConnection(...args),
    disconnect: (...args: unknown[]) => disconnect(...args),
  },
}));

describe("agent catalog oauth routes", () => {
  const originalEnv = process.env;
  const app = express();
  app.use(express.json());
  app.use("/api/integrations/agent-catalog", router);

  beforeEach(() => {
    process.env = { ...originalEnv, DASHBOARD_APP_URL: "https://dashboard.autoflow.test" };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("redirects callback to error state when provider returns oauth error", async () => {
    const response = await request(app).get(
      "/api/integrations/agent-catalog/google/oauth/callback?error=access_denied&error_description=user_cancelled"
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("/agents/oauth/callback");
    expect(response.headers.location).toContain("provider=google");
    expect(response.headers.location).toContain("status=error");
  });

  it("redirects callback to success only when completeOAuth succeeds", async () => {
    completeOAuth.mockResolvedValue({ id: "conn-1" });

    const response = await request(app).get(
      "/api/integrations/agent-catalog/github/oauth/callback?code=code-123&state=state-123"
    );

    expect(response.status).toBe(302);
    expect(completeOAuth).toHaveBeenCalledWith({
      provider: "github",
      code: "code-123",
      state: "state-123",
    });
    expect(response.headers.location).toContain("provider=github");
    expect(response.headers.location).toContain("status=success");
  });

  it("redirects callback to error when completeOAuth fails", async () => {
    completeOAuth.mockRejectedValue(new AgentCatalogConnectorError("auth", "token exchange failed", 401));

    const response = await request(app).get(
      "/api/integrations/agent-catalog/notion/oauth/callback?code=code-123&state=state-123"
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("provider=notion");
    expect(response.headers.location).toContain("status=error");
    expect(response.headers.location).toContain("token+exchange+failed");
  });

  it("starts oauth flow for authenticated user", async () => {
    beginOAuth.mockReturnValue({ authUrl: "https://example.com/oauth", state: "abc", expiresInSeconds: 600 });

    const response = await request(app)
      .post("/api/integrations/agent-catalog/google/oauth/start")
      .set("Authorization", "Bearer user-123")
      .send({});

    expect(response.status).toBe(201);
    expect(beginOAuth).toHaveBeenCalledWith("user-123", "google");
    expect(response.body.authUrl).toBe("https://example.com/oauth");
  });
});
