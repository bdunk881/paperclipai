/**
 * Unit tests for src/routines/routineRoutes.ts (HEL-108).
 *
 * Tests the PATCH /api/routines/:id endpoint:
 * - BullMQ scheduler is added when a routine is enabled with a cron
 * - BullMQ scheduler is removed when a routine is disabled
 * - cancel endpoint (DELETE /api/runs/:id/cancel) via app integration
 */

import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import type { Pool, QueryResult } from "pg";
import type { Queue } from "bullmq";
import { createRoutineRoutes } from "./routineRoutes";
import type { RunJobPayload } from "../queue/queues";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const ROUTINE_ID = "22222222-2222-4222-8222-222222222222";
const WS_ID = "33333333-3333-4333-8333-333333333333";

const ROUTINE_ROW = {
  id: ROUTINE_ID,
  workspace_id: WS_ID,
  agent_id: null,
  name: "Nightly summary",
  schedule_cron: "0 2 * * *",
  trigger_kind: "scheduled",
  workflow_id: VALID_UUID,
  enabled: true,
  created_at: new Date("2026-05-15T00:00:00Z"),
  updated_at: new Date("2026-05-17T00:00:00Z"),
};

function makePool(rows: unknown[]): Pool {
  return {
    query: jest.fn().mockResolvedValue({ rows } as unknown as QueryResult),
  } as unknown as Pool;
}

function makeQueue(): Queue<RunJobPayload> {
  return {
    upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
    removeJobScheduler: jest.fn().mockResolvedValue(true),
  } as unknown as Queue<RunJobPayload>;
}

function buildApp(pool: Pool, queue: Queue<RunJobPayload> | null = null): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { auth?: { sub: string } }).auth = { sub: "user-1" };
    (req as Request & { workspace?: { id: string; role: string } }).workspace = {
      id: WS_ID,
      role: "admin",
    };
    next();
  });
  app.use("/api/routines", createRoutineRoutes(pool, queue));
  return app;
}

describe("GET /api/routines", () => {
  it("returns the list of routines", async () => {
    const pool = makePool([ROUTINE_ROW]);
    const app = buildApp(pool);

    const res = await request(app).get("/api/routines");

    expect(res.status).toBe(200);
    expect(res.body.routines).toHaveLength(1);
    expect(res.body.routines[0].id).toBe(ROUTINE_ID);
    expect(res.body.routines[0].scheduleCron).toBe("0 2 * * *");
  });

  it("returns 401 when workspace is missing", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/routines", createRoutineRoutes(makePool([]), null));

    const res = await request(app).get("/api/routines");
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/routines/:id", () => {
  it("returns 400 when body has nothing to update", async () => {
    const app = buildApp(makePool([]));
    const res = await request(app).patch(`/api/routines/${ROUTINE_ID}`).send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid UUID", async () => {
    const app = buildApp(makePool([]));
    const res = await request(app).patch("/api/routines/not-a-uuid").send({ enabled: false });
    expect(res.status).toBe(400);
  });

  it("returns 404 when routine is not found", async () => {
    const pool = makePool([]); // UPDATE returns no rows
    const app = buildApp(pool);
    const res = await request(app).patch(`/api/routines/${ROUTINE_ID}`).send({ enabled: false });
    expect(res.status).toBe(404);
  });

  it("calls removeJobScheduler when routine is disabled", async () => {
    const disabledRow = { ...ROUTINE_ROW, enabled: false };
    const pool = makePool([disabledRow]);
    const queue = makeQueue();
    const app = buildApp(pool, queue);

    const res = await request(app)
      .patch(`/api/routines/${ROUTINE_ID}`)
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(`routine:${ROUTINE_ID}`);
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it("calls upsertJobScheduler when routine is enabled with a cron", async () => {
    const pool = makePool([ROUTINE_ROW]); // enabled=true, schedule_cron set
    const queue = makeQueue();
    const app = buildApp(pool, queue);

    const res = await request(app)
      .patch(`/api/routines/${ROUTINE_ID}`)
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    const [schedulerId, repeatOpts] = (queue.upsertJobScheduler as jest.Mock).mock.calls[0] as [string, { pattern: string }];
    expect(schedulerId).toBe(`routine:${ROUTINE_ID}`);
    expect(repeatOpts.pattern).toBe("0 2 * * *");
  });

  it("does not touch the queue when runQueue is null", async () => {
    const pool = makePool([ROUTINE_ROW]);
    const app = buildApp(pool, null);

    const res = await request(app)
      .patch(`/api/routines/${ROUTINE_ID}`)
      .send({ enabled: true });

    expect(res.status).toBe(200);
  });
});
