import request from "supertest";

function loadAppWithAllowedOrigins(allowedOrigins?: string, extraEnv: Record<string, string | undefined> = {}) {
  const originalEnv = process.env;
  process.env = { ...originalEnv };

  if (allowedOrigins === undefined) {
    delete process.env.ALLOWED_ORIGINS;
  } else {
    process.env.ALLOWED_ORIGINS = allowedOrigins;
  }

  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  jest.resetModules();
  jest.doMock("./engine/llmProviders", () => ({
    getProvider: jest.fn(),
  }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const app = require("./app").default as import("express").Express;
  process.env = originalEnv;
  return app;
}

describe("app security middleware", () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it("adds helmet security headers", async () => {
    const app = loadAppWithAllowedOrigins("https://dashboard.autoflow.test");
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBeDefined();
    expect(res.headers["strict-transport-security"]).toBeDefined();
  });

  it("allows configured CORS origins and credentials", async () => {
    const app = loadAppWithAllowedOrigins("https://dashboard.autoflow.test");
    const res = await request(app)
      .get("/health")
      .set("Origin", "https://dashboard.autoflow.test");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://dashboard.autoflow.test");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("does not allow unlisted CORS origins", async () => {
    const app = loadAppWithAllowedOrigins("https://dashboard.autoflow.test");
    const res = await request(app)
      .get("/health")
      .set("Origin", "https://evil.example");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("ignores wildcard origins when credentials are enabled", async () => {
    const app = loadAppWithAllowedOrigins("*,https://dashboard.autoflow.test");
    const res = await request(app)
      .get("/health")
      .set("Origin", "https://evil.example");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows dashboard origins declared through the social auth allowlist", async () => {
    const app = loadAppWithAllowedOrigins("https://app.helloautoflow.com", {
      AUTH_SOCIAL_ALLOWED_REDIRECT_ORIGINS: "https://staging.app.helloautoflow.com",
      SOCIAL_AUTH_DASHBOARD_URL: "https://staging.app.helloautoflow.com",
    });
    const res = await request(app)
      .get("/health")
      .set("Origin", "https://staging.app.helloautoflow.com");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://staging.app.helloautoflow.com");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("allows origins declared through the native auth proxy allowlist", async () => {
    const app = loadAppWithAllowedOrigins("https://app.helloautoflow.com", {
      AUTH_NATIVE_AUTH_PROXY_ALLOWED_ORIGINS: "https://staging.app.helloautoflow.com",
    });
    const res = await request(app)
      .get("/api/tickets/sla/settings?workspaceId=11111111-1111-4111-8111-111111111111")
      .set("Origin", "https://staging.app.helloautoflow.com");

    expect(res.status).toBe(401);
    expect(res.headers["access-control-allow-origin"]).toBe("https://staging.app.helloautoflow.com");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});
