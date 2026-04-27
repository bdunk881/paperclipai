import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import handler from "./[...path]";

type MockResponse = {
  statusCode?: number;
  body?: unknown;
  headers: Record<string, string>;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  send: (payload: unknown) => MockResponse;
  setHeader: (name: string, value: string) => void;
};

function createResponse(): MockResponse {
  return {
    headers: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
}

describe("dashboard native auth proxy", () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      AZURE_CIAM_TENANT_SUBDOMAIN: "autoflowciam",
      AZURE_CIAM_TENANT_ID: "tenant-guid",
    };
    global.fetch = vi.fn() as unknown as typeof fetch;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("logs sanitized request and response details", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 400,
      headers: new Headers({
        "content-type": "application/json",
        "x-ms-request-id": "ms-request-456",
        "x-ms-correlation-id": "ms-corr-456",
      }),
      text: vi
        .fn()
        .mockResolvedValue(JSON.stringify({ error: "invalid_grant", error_description: "Bad password" })),
    } as unknown as Response);

    const req = {
      method: "POST",
      query: { path: ["signin", "v1.0", "start"] },
      headers: {
        origin: "https://dashboard.autoflow.test",
        "x-correlation-id": "corr-456",
      },
      body: {
        username: "alex@example.com",
        password: "super-secret-password",
        continuation_token: "token-secret",
      },
    };
    const res = createResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(400);
    const logOutput = vi.mocked(console.log).mock.calls.map(([message]) => String(message)).join("\n");
    expect(logOutput).toContain("[native-auth] REQUEST");
    expect(logOutput).toContain("[native-auth] RESPONSE");
    expect(logOutput).toContain('"password":"[REDACTED]"');
    expect(logOutput).toContain('"continuation_token":"[REDACTED]"');
    expect(logOutput).toContain('"username":"alex@example.com"');
    expect(logOutput).not.toContain("super-secret-password");
    expect(logOutput).not.toContain("token-secret");
    expect(logOutput).toContain('error="invalid_grant"');
    expect(logOutput).toContain('errorDescription="Bad password"');
    expect(logOutput).toContain('xMsRequestId="ms-request-456"');
    expect(logOutput).toContain('xMsCorrelationId="ms-corr-456"');
  });

  it("generates and forwards a correlation ID when none is provided", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: vi.fn().mockResolvedValue(JSON.stringify({ ok: true })),
    } as unknown as Response);

    const req = {
      method: "POST",
      query: { path: ["oauth2", "v2.0", "challenge"] },
      headers: {
        origin: "https://dashboard.autoflow.test",
      },
      body: {
        username: "alex@example.com",
      },
    };
    const res = createResponse();

    await handler(req as never, res as never);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-correlation-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});
