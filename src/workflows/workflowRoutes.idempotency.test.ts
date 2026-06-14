/**
 * HEL-792 — POST /api/workflows is idempotent on (workspace_id,
 * external_template_id).
 *
 * Re-saving an already-imported workflow must RESOLVE the existing workflows
 * row and return its latest version instead of bare-INSERTing — the bare INSERT
 * violated uq_workflows_workspace_external_template, 500'd, and was silently
 * swallowed by the dashboard dual-write. This drives a scripted client through a
 * mocked workspace context so the control flow is exercised without a live
 * Postgres; the ON CONFLICT clause itself mirrors the proven
 * persistImportedTemplate upsert, and live INSERT coverage lives in
 * rls.integration.test.ts.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount?: number;
}
interface FakeClient {
  query: jest.Mock<Promise<QueryResult>, [string, unknown[]?]>;
}

// Mutable so each test can install its own scripted client before the request.
let fakeClient: FakeClient;

jest.mock("../middleware/workspaceContext", () => ({
  withWorkspaceContext: (
    _pool: unknown,
    _ctx: unknown,
    cb: (client: FakeClient) => unknown,
  ) => cb(fakeClient),
}));

import { createWorkflowRoutes } from "./workflowRoutes";

const stubPool = { query: jest.fn() } as unknown as Parameters<typeof createWorkflowRoutes>[0];
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { auth?: { sub: string } }).auth = { sub: "user-1" };
    (req as Request & { workspace?: { id: string; role: string } }).workspace = {
      id: WORKSPACE_ID,
      role: "owner",
    };
    next();
  });
  app.use("/api/workflows", createWorkflowRoutes(stubPool));
  return app;
}

/** A query mock that returns scripted rows by matching SQL substrings. */
function scriptClient(
  handlers: Array<{ match: RegExp; rows: Array<Record<string, unknown>> }>,
): FakeClient {
  return {
    query: jest.fn(async (sql: string) => {
      for (const handler of handlers) {
        if (handler.match.test(sql)) return { rows: handler.rows };
      }
      return { rows: [] };
    }),
  };
}

const NOW = new Date("2026-06-14T00:00:00.000Z");

describe("HEL-792 POST /api/workflows idempotency", () => {
  it("resolves an existing (workspace, external_template_id) row without appending a version", async () => {
    fakeClient = scriptClient([
      { match: /INSERT INTO workflows[\s\S]*ON CONFLICT/i, rows: [{ id: "wf-existing" }] },
      {
        match: /JOIN workflow_versions v ON v\.id = w\.latest_version_id/i,
        rows: [{ id: "ver-1", version: 1, dag: { steps: [] }, created_at: NOW }],
      },
      {
        match: /SELECT created_at, updated_at FROM workflows/i,
        rows: [{ created_at: NOW, updated_at: NOW }],
      },
    ]);

    const res = await request(buildApp())
      .post("/api/workflows")
      .send({ name: "Imported flow", dag: { steps: [] }, externalTemplateId: "tpl-x" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("wf-existing");
    expect(res.body.latestVersion.id).toBe("ver-1");
    // The existing version is reused — no redundant second version is inserted.
    const sqls = fakeClient.query.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => /INSERT INTO workflow_versions/i.test(s))).toBe(false);
    // And the shell upsert is idempotent (ON CONFLICT), never a bare INSERT.
    expect(sqls.some((s) => /INSERT INTO workflows[\s\S]*ON CONFLICT/i.test(s))).toBe(true);
  });

  it("creates v1 for a brand-new workflow with no prior version", async () => {
    fakeClient = scriptClient([
      { match: /INSERT INTO workflows[\s\S]*ON CONFLICT/i, rows: [{ id: "wf-new" }] },
      { match: /JOIN workflow_versions v ON v\.id = w\.latest_version_id/i, rows: [] },
      { match: /INSERT INTO workflow_versions/i, rows: [{ created_at: NOW }] },
      {
        match: /SELECT created_at, updated_at FROM workflows/i,
        rows: [{ created_at: NOW, updated_at: NOW }],
      },
    ]);

    const res = await request(buildApp())
      .post("/api/workflows")
      .send({ name: "Fresh flow", dag: { steps: [] }, externalTemplateId: "tpl-new" });

    expect(res.status).toBe(201);
    expect(res.body.latestVersion.version).toBe(1);
    const sqls = fakeClient.query.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => /INSERT INTO workflow_versions/i.test(s))).toBe(true);
  });
});
