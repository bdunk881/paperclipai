import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("qa-preview-access handler", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.QA_PREVIEW_ACCESS_TOKEN;
    delete process.env.QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW;
    delete process.env.VERCEL_ENV;
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
    process.env.QA_PREVIEW_ACCESS_TOKEN = "secret-token";
    const res = createResponse();

    await handler({ method: "POST", body: { token: "secret-token" } } as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.body).toEqual({
      user: {
        id: "usr-qa-preview",
        email: "qa-preview@autoflow.local",
        name: "QA Preview User",
      },
    });
  });
});
