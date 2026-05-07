import { describe, expect, it } from "vitest";

import handler from "./waitlist-signup";

type MockResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  send: (payload: unknown) => MockResponse;
  setHeader: (name: string, value: string) => void;
};

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
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
}

describe("waitlist signup handler", () => {
  it("answers CORS preflight for production app requests", async () => {
    const res = createResponse();

    await handler(
      {
        method: "OPTIONS",
        headers: { origin: "https://app.helloautoflow.com" },
      } as never,
      res as never
    );

    expect(res.statusCode).toBe(204);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("https://app.helloautoflow.com");
    expect(res.headers["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
    expect(res.headers["Access-Control-Allow-Headers"]).toBe("Content-Type");
    expect(res.headers["Access-Control-Max-Age"]).toBe("86400");
    expect(res.headers.Vary).toBe("Origin");
  });

  it("returns CORS headers on successful POST requests", async () => {
    const res = createResponse();

    await handler(
      {
        method: "POST",
        headers: { origin: "https://app.helloautoflow.com" },
        body: { email: "alex@example.com" },
      } as never,
      res as never
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("https://app.helloautoflow.com");
  });

  it("does not reflect unapproved origins", async () => {
    const res = createResponse();

    await handler(
      {
        method: "OPTIONS",
        headers: { origin: "https://evil.example.com" },
      } as never,
      res as never
    );

    expect(res.statusCode).toBe(204);
    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
