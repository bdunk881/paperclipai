/**
 * HEL-250 creditsPoolRoutes — handler behaviour (validation + audit ordering).
 *
 * The keySourceStore is mocked so the test stays in-process; the integration
 * coverage for the underlying SQL lives in keySourceStore.test.ts.
 */

import express from "express";
import request from "supertest";
import type { PoolClient } from "pg";
import { createCreditsPoolRoutes } from "./creditsPoolRoutes";
import { __resetRateLimitsForTests } from "./rateLimit";

jest.mock("../billing/credits/keySourceStore", () => ({
  insertKeySource: jest.fn(),
  listKeySources: jest.fn(),
  rotateKeySourceCiphertext: jest.fn(),
  setStatus: jest.fn(),
  updateKeySourceMeta: jest.fn(),
}));

import * as store from "../billing/credits/keySourceStore";

const TEST_UUID = "11111111-1111-4111-8111-111111111111";

function mockClient(): { client: PoolClient; queries: string[] } {
  const queries: string[] = [];
  const client = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return { rows: [{ id: "audit-1" }], rowCount: 1 };
    }),
  } as unknown as PoolClient;
  return { client, queries };
}

function buildApp(client: PoolClient, adminId = "admin-1") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      auth: { sub: adminId },
      platformAdmin: { userId: adminId, email: null },
      platformAdminDb: client,
    });
    next();
  });
  // Pool is unused (store is mocked); pass an empty object as the cast.
  app.use("/", createCreditsPoolRoutes({} as never));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetRateLimitsForTests();
});

describe("HEL-250 creditsPoolRoutes", () => {
  describe("GET /", () => {
    it("lists key sources and audits the read", async () => {
      const { client } = mockClient();
      (store.listKeySources as jest.Mock).mockResolvedValue([
        { id: TEST_UUID, label: "or-main", priority: 100 },
      ]);
      const res = await request(buildApp(client)).get("/");
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      // Audit row must have been inserted on the same PoolClient.
      expect((client.query as jest.Mock).mock.calls.some((c) =>
        String(c[0]).includes("INSERT INTO platform_admin_audit_log"),
      )).toBe(true);
    });
  });

  describe("POST /", () => {
    it("rejects unknown source_kind", async () => {
      const { client } = mockClient();
      const res = await request(buildApp(client))
        .post("/")
        .send({ source_kind: "garbage", provider: "openai", label: "x", api_key: "abcdefgh", reason: "test" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/source_kind/);
      expect(store.insertKeySource).not.toHaveBeenCalled();
    });

    it("rejects mismatch between source_kind=openrouter and provider!=openrouter", async () => {
      const { client } = mockClient();
      const res = await request(buildApp(client)).post("/").send({
        source_kind: "openrouter",
        provider: "openai",
        label: "x",
        api_key: "abcdefgh",
        reason: "wrong combo",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/openrouter source_kind requires/);
    });

    it("rejects short api_key", async () => {
      const { client } = mockClient();
      const res = await request(buildApp(client)).post("/").send({
        source_kind: "direct",
        provider: "anthropic",
        label: "x",
        api_key: "short",
        reason: "test",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/api_key length/);
    });

    it("rejects missing reason", async () => {
      const { client } = mockClient();
      const res = await request(buildApp(client)).post("/").send({
        source_kind: "direct",
        provider: "anthropic",
        label: "ant-main",
        api_key: "sk-ant-12345678",
        reason: "",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/reason required/);
    });

    it("audits BEFORE inserting, masks the key tail in the audit payload, and returns only the masked tail", async () => {
      const { client } = mockClient();
      const calls: string[] = [];
      (client.query as jest.Mock).mockImplementation(async (sql: string) => {
        calls.push("audit");
        return { rows: [{ id: "audit-1" }], rowCount: 1 };
      });
      (store.insertKeySource as jest.Mock).mockImplementation(async () => {
        calls.push("insert");
        return TEST_UUID;
      });

      const res = await request(buildApp(client))
        .post("/")
        .send({
          source_kind: "direct",
          provider: "anthropic",
          label: "ant-main",
          api_key: "sk-ant-LONG-LIVE-A-TEST-KEY-1234",
          priority: 10,
          daily_spend_cap_usd: 50,
          reason: "onboarding direct anthropic",
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: TEST_UUID, masked_key: "****1234" });
      expect(calls).toEqual(["audit", "insert"]);
      // Audit payload must include the masked tail but NOT the raw key.
      const auditArgs = (client.query as jest.Mock).mock.calls[0][1];
      const payload = JSON.parse(auditArgs[5]);
      expect(payload.api_key_tail).toBe("****1234");
      expect(JSON.stringify(payload)).not.toContain("sk-ant-LONG-LIVE");
    });
  });

  describe("PATCH /:id", () => {
    it("rejects invalid uuid", async () => {
      const { client } = mockClient();
      const res = await request(buildApp(client)).patch("/not-a-uuid").send({ priority: 5, reason: "test" });
      expect(res.status).toBe(400);
    });

    it("rejects empty patch", async () => {
      const { client } = mockClient();
      const res = await request(buildApp(client)).patch(`/${TEST_UUID}`).send({ reason: "test" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/nothing to update/);
    });

    it("rejects runtime-only statuses (throttled, low_balance)", async () => {
      const { client } = mockClient();
      for (const bad of ["throttled", "low_balance"]) {
        const res = await request(buildApp(client))
          .patch(`/${TEST_UUID}`)
          .send({ status: bad, reason: "manual flip" });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/runtime-managed/);
      }
    });

    it("forwards priority + status updates and returns 404 when the row is missing", async () => {
      const { client } = mockClient();
      (store.updateKeySourceMeta as jest.Mock).mockResolvedValue(false);
      const res = await request(buildApp(client))
        .patch(`/${TEST_UUID}`)
        .send({ priority: 1, reason: "promote" });
      expect(res.status).toBe(404);
      expect(store.updateKeySourceMeta).toHaveBeenCalledWith(TEST_UUID, expect.objectContaining({ priority: 1 }));
    });
  });

  describe("POST /:id/rotate", () => {
    it("enforces the daily rate limit (10/day per admin)", async () => {
      const { client } = mockClient();
      (store.rotateKeySourceCiphertext as jest.Mock).mockResolvedValue(true);
      const body = { api_key: "new-secret-abcdefgh", reason: "leaked on forum" };
      for (let i = 0; i < 10; i += 1) {
        const res = await request(buildApp(client)).post(`/${TEST_UUID}/rotate`).send(body);
        expect(res.status).toBe(200);
      }
      const eleventh = await request(buildApp(client)).post(`/${TEST_UUID}/rotate`).send(body);
      expect(eleventh.status).toBe(500); // rate-limit Error bubbles via next(err) → 500
    });

    it("audits before rotating, never logs the plaintext", async () => {
      const { client } = mockClient();
      (store.rotateKeySourceCiphertext as jest.Mock).mockResolvedValue(true);
      const res = await request(buildApp(client))
        .post(`/${TEST_UUID}/rotate`)
        .send({ api_key: "rotated-key-abcdef", reason: "scheduled rotation" });
      expect(res.status).toBe(200);
      expect(res.body.masked_key).toBe("****cdef");
      const auditArgs = (client.query as jest.Mock).mock.calls[0][1];
      const payload = JSON.parse(auditArgs[5]);
      expect(payload.api_key_tail).toBe("****cdef");
      expect(JSON.stringify(payload)).not.toContain("rotated-key-abcdef");
    });

    it("returns 404 when the row is missing", async () => {
      const { client } = mockClient();
      (store.rotateKeySourceCiphertext as jest.Mock).mockResolvedValue(false);
      const res = await request(buildApp(client))
        .post(`/${TEST_UUID}/rotate`)
        .send({ api_key: "rotated-key-abcdef", reason: "test" });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /:id/disable", () => {
    it("is idempotent — repeat calls all succeed", async () => {
      const { client } = mockClient();
      const a = await request(buildApp(client))
        .post(`/${TEST_UUID}/disable`)
        .send({ reason: "abuse" });
      const b = await request(buildApp(client))
        .post(`/${TEST_UUID}/disable`)
        .send({ reason: "abuse-again" });
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(store.setStatus).toHaveBeenCalledTimes(2);
      expect(store.setStatus).toHaveBeenLastCalledWith(TEST_UUID, "disabled");
    });

    it("requires reason", async () => {
      const { client } = mockClient();
      const res = await request(buildApp(client)).post(`/${TEST_UUID}/disable`).send({ reason: "" });
      expect(res.status).toBe(400);
      expect(store.setStatus).not.toHaveBeenCalled();
    });
  });
});
