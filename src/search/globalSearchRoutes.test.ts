import express, { type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { createGlobalSearchRoutes } from "./globalSearchRoutes";

const WS_UUID = "11111111-1111-4111-8111-111111111111";

function buildApp(
  pool: Pool,
  authOverrides: { sub?: string; workspaceId?: string } = {
    sub: "user-1",
    workspaceId: WS_UUID,
  },
) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (authOverrides.sub) {
      (req as Request & { auth?: { sub: string } }).auth = { sub: authOverrides.sub };
    }
    if (authOverrides.workspaceId) {
      (req as Request & { workspace?: { id: string; role: string }; workspaceId?: string }).workspace = {
        id: authOverrides.workspaceId,
        role: "owner",
      };
      (req as Request & { workspaceId?: string }).workspaceId = authOverrides.workspaceId;
    }
    next();
  });
  app.use("/api/search", createGlobalSearchRoutes(pool));
  return app;
}

function makePool(rows: unknown[] = []) {
  const client = {
    query: jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows, rowCount: rows.length })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    release: jest.fn(),
  };
  const pool = {
    connect: jest.fn().mockResolvedValue(client),
  } as unknown as Pool;
  return { pool, client };
}

describe("GET /api/search", () => {
  it("rejects unauthenticated requests", async () => {
    const { pool } = makePool();
    const app = buildApp(pool, { workspaceId: WS_UUID });

    const res = await request(app).get("/api/search?q=mission");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Authentication required/);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("rejects requests without workspace context", async () => {
    const { pool } = makePool();
    const app = buildApp(pool, { sub: "user-1" });

    const res = await request(app).get("/api/search?q=mission");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Workspace context required/);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("returns normalized tenant-scoped results across canonical entities", async () => {
    const { pool, client } = makePool([
      {
        type: "agent",
        id: "agent-1",
        title: "Revenue Analyst",
        subtitle: "Sales Ops",
        status: "active",
        route: "/agents/agent-1",
        matched_fields: ["name"],
        updated_at: new Date("2026-05-19T16:00:00.000Z"),
      },
      {
        type: "mission",
        id: "mission-1",
        title: "Grow renewal pipeline",
        subtitle: "Acme Robotics",
        status: "active",
        route: "/mission-state?mission=mission-1",
        matched_fields: null,
        updated_at: "2026-05-18T10:00:00.000Z",
      },
    ]);
    const app = buildApp(pool);

    const res = await request(app).get("/api/search?q=revenue&limit=50");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      query: "revenue",
      total: 2,
      results: [
        {
          type: "agent",
          id: "agent-1",
          title: "Revenue Analyst",
          subtitle: "Sales Ops",
          status: "active",
          route: "/agents/agent-1",
          matchedFields: ["name"],
          updatedAt: "2026-05-19T16:00:00.000Z",
        },
        {
          type: "mission",
          id: "mission-1",
          title: "Grow renewal pipeline",
          subtitle: "Acme Robotics",
          status: "active",
          route: "/mission-state?mission=mission-1",
          matchedFields: [],
          updatedAt: "2026-05-18T10:00:00.000Z",
        },
      ],
    });

    const [sql, params] = (client.query as jest.Mock).mock.calls[3];
    expect(sql).toContain("WHERE c.workspace_id = $1::uuid");
    expect(sql).toContain("WHERE a.workspace_id = $1::uuid");
    expect(sql).toContain("WHERE r.workspace_id = $1::uuid");
    expect(sql).toContain("approval_agent.workspace_id = $1::uuid");
    expect(params).toEqual([WS_UUID, "user-1", "%revenue%", "revenue", 25]);
  });

  it("escapes LIKE wildcards in the query text", async () => {
    const { pool, client } = makePool();
    const app = buildApp(pool);

    const res = await request(app).get("/api/search?q=100%25_growth");

    expect(res.status).toBe(200);
    const [, params] = (client.query as jest.Mock).mock.calls[3];
    expect(params).toEqual([WS_UUID, "user-1", "%100\\%\\_growth%", "100%_growth", 10]);
  });
});
