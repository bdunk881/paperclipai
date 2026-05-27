import { describe, it, expect, beforeEach } from "vitest";
import { onRequest, type QaPreviewEnv } from "./qa-preview-access";

function makeContext(opts: {
  method?: string;
  body?: unknown;
  env?: Partial<QaPreviewEnv>;
}) {
  const request = new Request("https://preview.pages.dev/api/qa-preview-access", {
    method: opts.method ?? "POST",
    headers: { "Content-Type": "application/json" },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const env: QaPreviewEnv = {
    APP_JWT_SECRET: "test-jwt-secret-32-bytes-long-min",
    QA_PREVIEW_ACCESS_TOKEN: "expected-preview-token",
    QA_PREVIEW_DEPLOYMENT_KIND: "preview",
    ...opts.env,
  };
  return { request, env };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("qa-preview-access Pages Function", () => {
  beforeEach(() => {
    // each test builds its own context — no shared state to reset
  });

  it("rejects non-POST", async () => {
    const ctx = makeContext({ method: "GET" });
    const res = await onRequest(ctx);
    expect(res.status).toBe(405);
    const body = await readJson(res);
    expect(body.error).toBe("Method not allowed");
  });

  it("rejects non-preview deployments by default (fail-closed)", async () => {
    const ctx = makeContext({
      body: { token: "expected-preview-token" },
      env: { QA_PREVIEW_DEPLOYMENT_KIND: "production" },
    });
    const res = await onRequest(ctx);
    expect(res.status).toBe(403);
    const body = await readJson(res);
    expect(body.error).toMatch(/preview deployments/);
  });

  it("rejects when QA_PREVIEW_DEPLOYMENT_KIND is unset", async () => {
    const ctx = makeContext({
      body: { token: "expected-preview-token" },
      env: { QA_PREVIEW_DEPLOYMENT_KIND: undefined },
    });
    const res = await onRequest(ctx);
    expect(res.status).toBe(403);
  });

  it("honors QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW only when deployment kind is not production", async () => {
    const ctx = makeContext({
      body: { token: "expected-preview-token" },
      env: {
        QA_PREVIEW_DEPLOYMENT_KIND: "dev",
        QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW: "true",
      },
    });
    const res = await onRequest(ctx);
    expect(res.status).toBe(200);
  });

  it("ignores QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW when deployment kind is production", async () => {
    const ctx = makeContext({
      body: { token: "expected-preview-token" },
      env: {
        QA_PREVIEW_DEPLOYMENT_KIND: "production",
        QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW: "true",
      },
    });
    const res = await onRequest(ctx);
    expect(res.status).toBe(403);
  });

  it("503 when QA_PREVIEW_ACCESS_TOKEN is missing", async () => {
    const ctx = makeContext({
      body: { token: "anything" },
      env: { QA_PREVIEW_ACCESS_TOKEN: undefined },
    });
    const res = await onRequest(ctx);
    expect(res.status).toBe(503);
  });

  it("400 when body has no token", async () => {
    const ctx = makeContext({ body: {} });
    const res = await onRequest(ctx);
    expect(res.status).toBe(400);
  });

  it("401 when token doesn't match", async () => {
    const ctx = makeContext({ body: { token: "wrong-token" } });
    const res = await onRequest(ctx);
    expect(res.status).toBe(401);
  });

  it("503 when APP_JWT_SECRET is missing on successful token match", async () => {
    const ctx = makeContext({
      body: { token: "expected-preview-token" },
      env: { APP_JWT_SECRET: undefined },
    });
    const res = await onRequest(ctx);
    expect(res.status).toBe(503);
  });

  it("200 with a signed JWT on a happy path", async () => {
    const ctx = makeContext({ body: { token: "expected-preview-token" } });
    const res = await onRequest(ctx);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(typeof body.accessToken).toBe("string");
    expect((body.accessToken as string).split(".")).toHaveLength(3);
    expect(body.user).toEqual({
      id: "qa-smoke-user",
      email: "qa-preview@autoflow.local",
      name: "QA Preview User",
    });
  });

  it("sets Cache-Control: no-store on every response", async () => {
    const ctx = makeContext({ body: { token: "expected-preview-token" } });
    const res = await onRequest(ctx);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
