/**
 * HEL-599 treasuryRoutes — handler behaviour (status + provision gating +
 * audit ordering). stripeIssuing + treasuryLedgerStore are mocked so the test
 * stays in-process; their logic is covered in their own unit tests.
 */
import express from "express";
import request from "supertest";
import type { PoolClient } from "pg";
import { createTreasuryRoutes } from "./treasuryRoutes";

jest.mock("../billing/credits/stripeIssuing", () => ({
  ensureProviderCards: jest.fn(),
  isIssuingEnabled: jest.fn(),
  readIssuingBalanceUsd: jest.fn(),
}));
jest.mock("../billing/credits/treasuryLedgerStore", () => ({
  listProviderCards: jest.fn(),
  listRecentLedgerRows: jest.fn(),
  recentDeclineCount: jest.fn(),
}));

import * as issuing from "../billing/credits/stripeIssuing";
import * as ledger from "../billing/credits/treasuryLedgerStore";

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
  app.use("/", createTreasuryRoutes({} as never));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  (ledger.listProviderCards as jest.Mock).mockResolvedValue([]);
  (ledger.listRecentLedgerRows as jest.Mock).mockResolvedValue([]);
  (ledger.recentDeclineCount as jest.Mock).mockResolvedValue(0);
});

describe("HEL-599 treasuryRoutes", () => {
  describe("GET /", () => {
    it("returns status without hitting Stripe when disabled, and audits the read", async () => {
      (issuing.isIssuingEnabled as jest.Mock).mockReturnValue(false);
      const { client } = mockClient();

      const res = await request(buildApp(client)).get("/");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ enabled: false, issuingBalanceUsd: null, recentDeclines: 0 });
      expect(issuing.readIssuingBalanceUsd).not.toHaveBeenCalled();
      expect((client.query as jest.Mock).mock.calls.some((c) =>
        String(c[0]).includes("INSERT INTO platform_admin_audit_log"),
      )).toBe(true);
    });

    it("includes the live Issuing balance when enabled", async () => {
      (issuing.isIssuingEnabled as jest.Mock).mockReturnValue(true);
      (issuing.readIssuingBalanceUsd as jest.Mock).mockResolvedValue(1234.5);
      const { client } = mockClient();

      const res = await request(buildApp(client)).get("/");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ enabled: true, issuingBalanceUsd: 1234.5 });
    });

    it("surfaces a balance error instead of 500ing", async () => {
      (issuing.isIssuingEnabled as jest.Mock).mockReturnValue(true);
      (issuing.readIssuingBalanceUsd as jest.Mock).mockRejectedValue(new Error("stripe down"));
      const { client } = mockClient();

      const res = await request(buildApp(client)).get("/");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ enabled: true, issuingBalanceUsd: null, balanceError: "stripe down" });
    });
  });

  describe("POST /provision", () => {
    it("requires a reason", async () => {
      (issuing.isIssuingEnabled as jest.Mock).mockReturnValue(true);
      const { client } = mockClient();

      const res = await request(buildApp(client)).post("/provision").send({});

      expect(res.status).toBe(400);
      expect(issuing.ensureProviderCards).not.toHaveBeenCalled();
    });

    it("refuses to provision while the layer is disabled", async () => {
      (issuing.isIssuingEnabled as jest.Mock).mockReturnValue(false);
      const { client } = mockClient();

      const res = await request(buildApp(client)).post("/provision").send({ reason: "go live" });

      expect(res.status).toBe(409);
      expect(issuing.ensureProviderCards).not.toHaveBeenCalled();
    });

    it("provisions + audits when enabled", async () => {
      (issuing.isIssuingEnabled as jest.Mock).mockReturnValue(true);
      (issuing.ensureProviderCards as jest.Mock).mockResolvedValue({
        created: ["anthropic", "openai"], existing: [], skipped: false,
      });
      const { client } = mockClient();

      const res = await request(buildApp(client)).post("/provision").send({ reason: "go live" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ created: ["anthropic", "openai"] });
      expect(issuing.ensureProviderCards).toHaveBeenCalledTimes(1);
      expect((client.query as jest.Mock).mock.calls.some((c) =>
        String(c[0]).includes("INSERT INTO platform_admin_audit_log"),
      )).toBe(true);
    });
  });
});
