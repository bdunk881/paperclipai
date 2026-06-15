/**
 * HEL-799 (B2) — internal ydoc routes: authorize role/tenant gating + snapshot
 * save/load. Mocks the workspace role, RLS context, and snapshot store so the
 * route logic is exercised without a live Postgres. RLS isolation itself is
 * enforced by `withWorkspaceContext` (reused verbatim from
 * attachYDocUpgradeHandler; covered by rls.integration.test.ts).
 */
import express from "express";
import request from "supertest";

let mockRole: string | null = "owner";
let mockExists = true;
let loadResult: { state: Uint8Array; version: number } | null = null;
const saveMock = jest.fn(
  async (_wf: string, _ws: string, _uid: string, _bytes: Uint8Array): Promise<void> => {},
);

jest.mock("../middleware/workspaceResolver", () => ({
  resolveWorkspaceRole: jest.fn(async () => mockRole),
}));
jest.mock("../middleware/workspaceContext", () => ({
  withWorkspaceContext: async (
    _pool: unknown,
    _ctx: unknown,
    cb: (client: { query: () => Promise<{ rows: Array<{ id: string }> }> }) => unknown,
  ) => cb({ query: async () => ({ rows: mockExists ? [{ id: "wf" }] : [] }) }),
}));
jest.mock("../workflows/ydoc/ydocSnapshotStore", () => ({
  createYDocSnapshotStore: () => ({
    save: saveMock,
    load: async () => loadResult,
  }),
}));

import { createInternalRoutes } from "./routes";

const stubPool = {} as unknown as Parameters<typeof createInternalRoutes>[0];
const WS = "11111111-1111-4111-8111-111111111111";
const WF = "22222222-2222-4222-8222-222222222222";

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/internal", createInternalRoutes(stubPool));
  return app;
}

beforeEach(() => {
  mockRole = "owner";
  mockExists = true;
  loadResult = null;
  saveMock.mockClear();
});

describe("POST /api/internal/ydoc/authorize (HEL-799 B2)", () => {
  const send = (over: Record<string, unknown> = {}) =>
    request(buildApp())
      .post("/api/internal/ydoc/authorize")
      .send({ workflowId: WF, workspaceId: WS, userId: "u1", ...over });

  it("200 + role for an allowed member of an existing workflow", async () => {
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, role: "owner" });
  });

  it("403 when the role is not in the {owner,admin,developer} allowlist", async () => {
    mockRole = "viewer";
    expect((await send()).status).toBe(403);
  });

  it("403 when the user is not a member (null role)", async () => {
    mockRole = null;
    expect((await send()).status).toBe(403);
  });

  it("404 when the workflow doesn't exist in the workspace", async () => {
    mockExists = false;
    expect((await send()).status).toBe(404);
  });

  it("400 on a malformed workflowId", async () => {
    expect((await send({ workflowId: "not-a-uuid" })).status).toBe(400);
  });
});

describe("ydoc-snapshot routes (HEL-799 B2)", () => {
  it("POST persists the base64-decoded bytes and 204s", async () => {
    const state = Buffer.from([1, 2, 3, 250]).toString("base64");
    const res = await request(buildApp())
      .post(`/api/internal/workflows/${WF}/ydoc-snapshot`)
      .send({ workspaceId: WS, userId: "u1", state });
    expect(res.status).toBe(204);
    expect(saveMock).toHaveBeenCalledTimes(1);
    const [wf, ws, uid, bytes] = saveMock.mock.calls[0];
    expect([wf, ws, uid]).toEqual([WF, WS, "u1"]);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 250]);
  });

  it("GET returns base64 state + version", async () => {
    loadResult = { state: new Uint8Array([9, 9, 9]), version: 3 };
    const res = await request(buildApp())
      .get(`/api/internal/workflows/${WF}/ydoc-snapshot`)
      .query({ workspaceId: WS, userId: "u1" });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(3);
    expect(Array.from(Buffer.from(res.body.state, "base64"))).toEqual([9, 9, 9]);
  });

  it("GET 404 when there is no snapshot yet", async () => {
    loadResult = null;
    const res = await request(buildApp())
      .get(`/api/internal/workflows/${WF}/ydoc-snapshot`)
      .query({ workspaceId: WS, userId: "u1" });
    expect(res.status).toBe(404);
  });

  it("POST 400 when state is missing", async () => {
    const res = await request(buildApp())
      .post(`/api/internal/workflows/${WF}/ydoc-snapshot`)
      .send({ workspaceId: WS, userId: "u1" });
    expect(res.status).toBe(400);
  });
});
