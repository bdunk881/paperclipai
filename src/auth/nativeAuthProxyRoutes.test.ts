import request from "supertest";

type MockFetchResponse = {
  status: number;
  headers?: Record<string, string>;
  body?: string;
};

const originalEnv = process.env;
const originalFetch = global.fetch;

function mockFetchResponse({ status, headers, body = "" }: MockFetchResponse): Response {
  return {
    status,
    headers: new Headers(headers),
    text: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function loadApp(env: Record<string, string | undefined> = {}) {
  process.env = { ...originalEnv };

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  jest.resetModules();
  jest.doMock("../engine/llmProviders", () => ({
    getProvider: jest.fn(),
  }));

  return require("../app").default as import("express").Express;
}

describe("native auth proxy routes", () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it("proxies JSON requests to the configured native auth upstream", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockFetchResponse({
        status: 201,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "retry-after": "9",
        },
        body: JSON.stringify({ challengeId: "challenge-123" }),
      })
    );

    const app = loadApp({
      ALLOWED_ORIGINS: "https://dashboard.autoflow.test",
      AUTH_NATIVE_AUTH_PROXY_BASE_URL: "https://auth.helloautoflow.com/tenant-guid",
    });

    const response = await request(app)
      .post("/api/auth/native/signup/v1.0/start?dc=ESTS-PUB-WUS2-AZ1-FD000-TEST")
      .set("Origin", "https://dashboard.autoflow.test")
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .set("X-Correlation-Id", "corr-123")
      .send({ email: "alex@example.com" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ challengeId: "challenge-123" });
    expect(response.headers["retry-after"]).toBe("9");
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://auth.helloautoflow.com/tenant-guid/signup/v1.0/start?dc=ESTS-PUB-WUS2-AZ1-FD000-TEST"
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      accept: "application/json",
      "content-type": "application/json",
      "x-correlation-id": "corr-123",
    });
    expect(init.body).toBe(JSON.stringify({ email: "alex@example.com" }));
  });

  it("proxies form-encoded requests to the configured native auth upstream", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ continuation_token: "cont-123" }),
      })
    );

    const app = loadApp({
      ALLOWED_ORIGINS: "https://dashboard.autoflow.test",
      AUTH_NATIVE_AUTH_PROXY_BASE_URL: "https://auth.helloautoflow.com/tenant-guid",
    });

    const formBody = new URLSearchParams({
      client_id: "client-123",
      challenge_type: "password",
      username: "alex@example.com",
    }).toString();

    const response = await request(app)
      .post("/api/auth/native/challenge/v1.0/continue")
      .set("Origin", "https://dashboard.autoflow.test")
      .set("Accept", "application/json")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send(formBody);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ continuation_token: "cont-123" });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://auth.helloautoflow.com/tenant-guid/challenge/v1.0/continue");
    expect(init.headers).toMatchObject({
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(init.body).toBe(formBody);
  });

  it("allows the documented reset-password endpoints used by the frontend", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({ continuation_token: "reset-123" }),
        })
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({ status: "complete" }),
        })
      );

    const app = loadApp({
      ALLOWED_ORIGINS: "https://dashboard.autoflow.test",
      AUTH_NATIVE_AUTH_PROXY_BASE_URL: "https://auth.helloautoflow.com/tenant-guid",
    });

    const startResponse = await request(app)
      .post("/api/auth/native/resetpassword/v1.0/start")
      .set("Origin", "https://dashboard.autoflow.test")
      .set("Accept", "application/json")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("username=alex%40example.com");

    const pollResponse = await request(app)
      .post("/api/auth/native/resetpassword/v1.0/poll_completion")
      .set("Origin", "https://dashboard.autoflow.test")
      .set("Accept", "application/json")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("continuation_token=reset-123");

    expect(startResponse.status).toBe(200);
    expect(startResponse.body).toEqual({ continuation_token: "reset-123" });
    expect(pollResponse.status).toBe(200);
    expect(pollResponse.body).toEqual({ status: "complete" });
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const [startUrl] = (global.fetch as jest.Mock).mock.calls[0] as [URL, RequestInit];
    const [pollUrl] = (global.fetch as jest.Mock).mock.calls[1] as [URL, RequestInit];
    expect(startUrl.toString()).toBe("https://auth.helloautoflow.com/tenant-guid/resetpassword/v1.0/start");
    expect(pollUrl.toString()).toBe(
      "https://auth.helloautoflow.com/tenant-guid/resetpassword/v1.0/poll_completion"
    );
  });

  it("allows the documented signin endpoints", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockFetchResponse({
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ continuation_token: "signin-123" }),
      })
    );

    const app = loadApp({
      ALLOWED_ORIGINS: "https://dashboard.autoflow.test",
      AUTH_NATIVE_AUTH_PROXY_BASE_URL: "https://auth.helloautoflow.com/tenant-guid",
    });

    const response = await request(app)
      .post("/api/auth/native/signin/v1.0/start")
      .set("Origin", "https://dashboard.autoflow.test")
      .set("Accept", "application/json")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("username=alex%40example.com");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ continuation_token: "signin-123" });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://auth.helloautoflow.com/tenant-guid/signin/v1.0/start");
  });

  it("rejects requests from origins outside the configured allowlist", async () => {
    const app = loadApp({
      ALLOWED_ORIGINS: "https://dashboard.autoflow.test",
      AUTH_NATIVE_AUTH_PROXY_BASE_URL: "https://auth.helloautoflow.com/tenant-guid",
    });

    const response = await request(app)
      .post("/api/auth/native/signup/v1.0/start")
      .set("Origin", "https://evil.example")
      .send({ email: "alex@example.com" });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/origin is not allowed/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects unsafe upstream paths", async () => {
    const app = loadApp({
      ALLOWED_ORIGINS: "https://dashboard.autoflow.test",
      AUTH_NATIVE_AUTH_PROXY_BASE_URL: "https://auth.helloautoflow.com/tenant-guid",
    });

    const response = await request(app)
      .post("/api/auth/native/signup/%3Asecrets")
      .set("Origin", "https://dashboard.autoflow.test")
      .send({ email: "alex@example.com" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/path is not allowed/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects undocumented but syntactically safe endpoints", async () => {
    const app = loadApp({
      ALLOWED_ORIGINS: "https://dashboard.autoflow.test",
      AUTH_NATIVE_AUTH_PROXY_BASE_URL: "https://auth.helloautoflow.com/tenant-guid",
    });

    const response = await request(app)
      .post("/api/auth/native/signup/v1.0/submit")
      .set("Origin", "https://dashboard.autoflow.test")
      .send({ email: "alex@example.com" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/path is not allowed/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 502 when the upstream request fails", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("ECONNRESET"));

    const app = loadApp({
      ALLOWED_ORIGINS: "https://dashboard.autoflow.test",
      AUTH_NATIVE_AUTH_PROXY_BASE_URL: "https://auth.helloautoflow.com/tenant-guid",
    });

    const response = await request(app)
      .post("/api/auth/native/challenge/v1.0/continue")
      .set("Origin", "https://dashboard.autoflow.test")
      .send({ challengeId: "challenge-123" });

    expect(response.status).toBe(502);
    expect(response.body.error).toMatch(/native auth upstream request failed/i);
  });

  it("falls back to the derived ciamlogin authority when the branded host fetch fails", async () => {
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({ continuation_token: "fallback-123" }),
        })
      );

    const app = loadApp({
      ALLOWED_ORIGINS: "https://dashboard.autoflow.test",
      AUTH_NATIVE_AUTH_PROXY_BASE_URL: "https://auth.helloautoflow.com/tenant-guid",
      AZURE_CIAM_TENANT_SUBDOMAIN: "autoflowciam",
      AZURE_CIAM_TENANT_ID: "tenant-guid",
    });

    const response = await request(app)
      .post("/api/auth/native/challenge/v1.0/continue")
      .set("Origin", "https://dashboard.autoflow.test")
      .set("Accept", "application/json")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("continuation_token=challenge-123");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ continuation_token: "fallback-123" });
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const [firstUrl] = (global.fetch as jest.Mock).mock.calls[0] as [URL, RequestInit];
    const [secondUrl] = (global.fetch as jest.Mock).mock.calls[1] as [URL, RequestInit];
    expect(firstUrl.toString()).toBe("https://auth.helloautoflow.com/tenant-guid/challenge/v1.0/continue");
    expect(secondUrl.toString()).toBe("https://autoflowciam.ciamlogin.com/tenant-guid/challenge/v1.0/continue");
  });

  it("uses the AutoFlow CIAM defaults when the branded host is configured without tenant env vars", async () => {
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({ continuation_token: "default-fallback-123" }),
        })
      );

    const app = loadApp({
      ALLOWED_ORIGINS: "https://dashboard.autoflow.test",
      AUTH_NATIVE_AUTH_PROXY_BASE_URL:
        "https://auth.helloautoflow.com/5e4f1080-8afc-4005-b05e-32b21e69363a",
      AZURE_CIAM_TENANT_SUBDOMAIN: undefined,
      AZURE_CIAM_TENANT_ID: undefined,
      AZURE_TENANT_SUBDOMAIN: undefined,
      AZURE_TENANT_ID: undefined,
    });

    const response = await request(app)
      .post("/api/auth/native/challenge/v1.0/continue")
      .set("Origin", "https://dashboard.autoflow.test")
      .set("Accept", "application/json")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("continuation_token=challenge-123");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ continuation_token: "default-fallback-123" });
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const [firstUrl] = (global.fetch as jest.Mock).mock.calls[0] as [URL, RequestInit];
    const [secondUrl] = (global.fetch as jest.Mock).mock.calls[1] as [URL, RequestInit];
    expect(firstUrl.toString()).toBe(
      "https://auth.helloautoflow.com/5e4f1080-8afc-4005-b05e-32b21e69363a/challenge/v1.0/continue"
    );
    expect(secondUrl.toString()).toBe(
      "https://autoflowciam.ciamlogin.com/5e4f1080-8afc-4005-b05e-32b21e69363a/challenge/v1.0/continue"
    );
  });

  it("deduplicates native auth upstream candidates when configured values overlap", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("fetch failed"));

    const app = loadApp({
      ALLOWED_ORIGINS: "https://dashboard.autoflow.test",
      AUTH_NATIVE_AUTH_PROXY_BASE_URL: "https://autoflowciam.ciamlogin.com/tenant-guid",
      AZURE_CIAM_AUTHORITY: "https://autoflowciam.ciamlogin.com/tenant-guid",
      AZURE_CIAM_TENANT_SUBDOMAIN: "autoflowciam",
      AZURE_CIAM_TENANT_ID: "tenant-guid",
    });

    const response = await request(app)
      .post("/api/auth/native/challenge/v1.0/continue")
      .set("Origin", "https://dashboard.autoflow.test")
      .set("Accept", "application/json")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("continuation_token=challenge-123");

    expect(response.status).toBe(502);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported content types", async () => {
    const app = loadApp({
      ALLOWED_ORIGINS: "https://dashboard.autoflow.test",
      AUTH_NATIVE_AUTH_PROXY_BASE_URL: "https://auth.helloautoflow.com/tenant-guid",
    });

    const response = await request(app)
      .post("/api/auth/native/oauth2/v2.0/token")
      .set("Origin", "https://dashboard.autoflow.test")
      .set("Content-Type", "text/plain")
      .send("client_id=client-123");

    expect(response.status).toBe(415);
    expect(response.body.error).toMatch(/application\/json and application\/x-www-form-urlencoded/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("enforces a dedicated auth proxy rate limit", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      mockFetchResponse({
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ok: true }),
      })
    );

    const app = loadApp({
      ALLOWED_ORIGINS: "https://dashboard.autoflow.test",
      AUTH_NATIVE_AUTH_PROXY_BASE_URL: "https://auth.helloautoflow.com/tenant-guid",
      AUTH_NATIVE_AUTH_PROXY_RATE_LIMIT_MAX: "1",
      AUTH_NATIVE_AUTH_PROXY_RATE_LIMIT_WINDOW_MS: "60000",
    });

    const first = await request(app)
      .post("/api/auth/native/challenge/v1.0/continue")
      .set("Origin", "https://dashboard.autoflow.test")
      .send({ challengeId: "challenge-123" });
    const second = await request(app)
      .post("/api/auth/native/challenge/v1.0/continue")
      .set("Origin", "https://dashboard.autoflow.test")
      .send({ challengeId: "challenge-123" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.headers["retry-after"]).toBeDefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
