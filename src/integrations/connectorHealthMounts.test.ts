jest.mock("../engine/llmProviders", () => ({ getProvider: jest.fn() }));

jest.mock("../auth/authMiddleware", () => ({
  requireAuth: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    const headers = (req as { headers: Record<string, string | string[] | undefined> }).headers;
    if (!headers["authorization"]) {
      res.status(401).json({ error: "Missing or malformed Authorization header." });
      return;
    }
    const h = headers["x-user-id"];
    const sub = typeof h === "string" && h.trim() ? h.trim() : "test-user-id";
    req.auth = { sub, email: "test@example.com", roles: ["Operator"] };
    next();
  },
  requireAuthOrQaBypass: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    const headers = (req as { headers: Record<string, string | string[] | undefined> }).headers;
    if (!headers["authorization"]) {
      res.status(401).json({ error: "Missing or malformed Authorization header." });
      return;
    }
    const h = headers["x-user-id"];
    const sub = typeof h === "string" && h.trim() ? h.trim() : "test-user-id";
    req.auth = { sub, email: "test@example.com", roles: ["Operator"] };
    next();
  },
  requireRole: (..._roles: string[]) => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import request from "supertest";
import app from "../app";

const AUTH = { Authorization: "Bearer test-token", "X-User-Id": "qa-smoke-user" };

describe("connector health routes are mounted", () => {
  it.each(["linear", "sentry", "hubspot", "teams", "apollo"])(
    "serves %s health endpoint instead of 404",
    async (slug) => {
      const res = await request(app)
        .get(`/api/integrations/${slug}/health`)
        .set(AUTH);

      expect(res.status).not.toBe(404);
      expect([200, 206, 503]).toContain(res.status);
      expect(res.body).toEqual(expect.objectContaining({
        status: expect.any(String),
        checkedAt: expect.any(String),
        details: expect.objectContaining({
          auth: expect.any(Boolean),
          apiReachable: expect.any(Boolean),
          rateLimited: expect.any(Boolean),
        }),
      }));
    }
  );
});
