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
}));

jest.mock("../integrations/stripe/service", () => ({
  stripeConnectorService: {
    listInvoices: jest.fn(),
    listPaymentIntents: jest.fn(),
    listSubscriptions: jest.fn(),
  },
}));

import request from "supertest";
import app from "../app";
import { controlPlaneStore } from "../controlPlane/controlPlaneStore";
import { reportStore } from "./reportStore";
import { stripeConnectorService } from "../integrations/stripe/service";

const AUTH = { Authorization: "Bearer test-token" };

function currentMonthWindow() {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999)).toISOString();
  return { periodStart, periodEnd };
}

describe("report routes", () => {
  beforeEach(async () => {
    await reportStore.clear();
    jest.clearAllMocks();
  });

  it("generates, archives, lists, and fetches a board memo report", async () => {
    const window = currentMonthWindow();
    const userId = `report-user-${Date.now()}`;
    const team = await controlPlaneStore.createTeam({ userId, name: "Ops Team" });
    const done = await controlPlaneStore.createTask({
      userId,
      teamId: team.id,
      title: "Ship API",
      actor: "tester",
    });
    await controlPlaneStore.updateTaskStatus({
      taskId: done.id,
      userId,
      actor: "tester",
      status: "done",
    });
    const blocked = await controlPlaneStore.createTask({
      userId,
      teamId: team.id,
      title: "Fix billing edge case",
      actor: "tester",
    });
    await controlPlaneStore.updateTaskStatus({
      taskId: blocked.id,
      userId,
      actor: "tester",
      status: "blocked",
    });

    const createRes = await request(app)
      .post("/api/reporting/generate")
      .set(AUTH)
      .set("X-User-Id", userId)
      .set("X-Paperclip-Run-Id", "run-report-board")
      .send({
        kind: "board_memo",
        teamId: team.id,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
        deliveryChannels: ["inbox"],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.report.kind).toBe("board_memo");
    expect(createRes.body.report.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "tasks_completed", value: 1 }),
        expect.objectContaining({ key: "tasks_blocked", value: 1 }),
      ])
    );

    const listRes = await request(app)
      .get(`/api/reporting?teamId=${team.id}`)
      .set(AUTH)
      .set("X-User-Id", userId);

    expect(listRes.status).toBe(200);
    expect(listRes.body.total).toBe(1);

    const getRes = await request(app)
      .get(`/api/reporting/${createRes.body.report.id}`)
      .set(AUTH)
      .set("X-User-Id", userId);

    expect(getRes.status).toBe(200);
    expect(getRes.body.report.id).toBe(createRes.body.report.id);
    expect(getRes.body.report.sections[2].title).toBe("Blockers");
  });

  it("generates a financial statement from stripe connector data", async () => {
    const userId = `report-user-${Date.now() + 1}`;
    jest.mocked(stripeConnectorService.listInvoices).mockResolvedValue([
      { id: "inv-1", status: "paid", total: 8000, createdAt: "2026-04-02T00:00:00.000Z", livemode: false },
    ]);
    jest.mocked(stripeConnectorService.listPaymentIntents).mockResolvedValue([
      { id: "pi-1", status: "succeeded", amount: 7500, currency: "usd", createdAt: "2026-04-03T00:00:00.000Z", livemode: false },
    ]);
    jest.mocked(stripeConnectorService.listSubscriptions).mockResolvedValue([
      { id: "sub-1", status: "active", cancelAtPeriodEnd: false, createdAt: "2026-04-01T00:00:00.000Z", livemode: false },
    ]);

    const res = await request(app)
      .post("/api/reporting/generate")
      .set(AUTH)
      .set("X-User-Id", userId)
      .set("X-Paperclip-Run-Id", "run-report-financial")
      .send({
        kind: "financial_statement",
        periodStart: "2026-04-01T00:00:00.000Z",
        periodEnd: "2026-04-30T23:59:59.000Z",
        financialInputs: {
          openingCashMinor: 1000,
          operatingExpensesMinor: 5000,
        },
        deliveryChannels: ["email"],
        recipientEmail: "finance@example.com",
      });

    expect(res.status).toBe(201);
    expect(res.body.report.kind).toBe("financial_statement");
    expect(res.body.report.delivery).toEqual([
      expect.objectContaining({ channel: "email", status: "pending", recipient: "finance@example.com" }),
    ]);
    expect(res.body.report.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "recognized_revenue_minor", value: 8000 }),
        expect.objectContaining({ key: "cash_position_minor", value: 3500 }),
      ])
    );
  });
});
