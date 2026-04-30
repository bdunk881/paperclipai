import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./qa-preview-access";

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  setHeader: (name: string, value: string) => void;
}

function createResponse(): MockResponse {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  if (!payload) {
    throw new Error("missing token payload");
  }

  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("qa-preview-access handler", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.APP_JWT_SECRET;
    delete process.env.QA_PREVIEW_ACCESS_TOKEN;
    delete process.env.QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW;
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = "test";
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("rejects non-POST methods", async () => {
    const res = createResponse();

    await handler({ method: "GET" } as never, res as never);

    expect(res.statusCode).toBe(405);
  });

  it("rejects requests outside preview by default", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.QA_PREVIEW_ACCESS_TOKEN = "secret-token";
    const res = createResponse();

    await handler({ method: "POST", body: { token: "secret-token" } } as never, res as never);

    expect(res.statusCode).toBe(403);
  });

  it("rejects invalid tokens", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.QA_PREVIEW_ACCESS_TOKEN = "secret-token";
    const res = createResponse();

    await handler({ method: "POST", body: { token: "wrong-token" } } as never, res as never);

    expect(res.statusCode).toBe(401);
  });

  it("returns the QA preview user for valid preview tokens", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.APP_JWT_SECRET = "test-app-jwt-secret-with-sufficient-length";
    process.env.QA_PREVIEW_ACCESS_TOKEN = "secret-token";
    const res = createResponse();

    await handler({ method: "POST", body: { token: "secret-token" } } as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.body).toMatchObject({
      accessToken: expect.any(String),
      user: {
        id: "qa-smoke-user",
        email: "qa-preview@autoflow.local",
        name: "QA Preview User",
      },
    });
    const payload = res.body as { accessToken: string };
    expect(decodeJwtPayload(payload.accessToken)).toMatchObject({
      sub: "qa-smoke-user",
      email: "qa-preview@autoflow.local",
      name: "QA Preview User",
      iss: "autoflow-app",
      aud: "autoflow-api",
    });
  });

  it("returns 503 when app token signing is not configured", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.QA_PREVIEW_ACCESS_TOKEN = "secret-token";
    const res = createResponse();

    await handler({ method: "POST", body: { token: "secret-token" } } as never, res as never);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "QA preview access is not fully configured" });
  });

  // ALT-2078 Phase 5: production-boot guard parity. The
  // QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW override must be ignored when
  // NODE_ENV is "production" so a stray preview override cannot relax the
  // gate in a real production deployment.
  it("ignores QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    process.env.QA_PREVIEW_ACCESS_TOKEN = "secret-token";
    process.env.QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW = "true";
    const res = createResponse();

    await handler({ method: "POST", body: { token: "secret-token" } } as never, res as never);

    expect(res.statusCode).toBe(403);
  });

  it("honors QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW outside production for QA smoke runs", async () => {
    process.env.NODE_ENV = "test";
    process.env.VERCEL_ENV = "development";
    process.env.APP_JWT_SECRET = "test-app-jwt-secret-with-sufficient-length";
    process.env.QA_PREVIEW_ACCESS_TOKEN = "secret-token";
    process.env.QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW = "true";
    const res = createResponse();

    await handler({ method: "POST", body: { token: "secret-token" } } as never, res as never);

    expect(res.statusCode).toBe(200);
  });
});
