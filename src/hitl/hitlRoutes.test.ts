import express from "express";
import request from "supertest";
import { controlPlaneStore } from "../controlPlane/controlPlaneStore";
import hitlRoutes from "./hitlRoutes";
import { hitlStore } from "./hitlStore";

function auth(userId: string) {
  return { Authorization: `Bearer ${userId}` };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or malformed Authorization header." });
      return;
    }
    req.auth = { sub: authHeader.slice(7), email: "test@example.com" };
    next();
  });
  app.use("/api/hitl", hitlRoutes);
  return app;
}

describe("HITL contract routes", () => {
  beforeEach(() => {
    hitlStore.clear();
    controlPlaneStore.clear();
  });

  it("returns the default checkpoint schedule for a company", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/api/hitl/companies/company-1/checkpoint-schedule")
      .set(auth("user-1"));

    expect(res.status).toBe(200);
    expect(res.body.schedule.companyId).toBe("company-1");
    expect(res.body.schedule.weeklyReview.dayOfWeek).toBe(5);
    expect(res.body.schedule.notificationChannels).toEqual(["inbox", "agent_wake"]);
  });

  it("updates checkpoint schedule guardrails and kpi thresholds", async () => {
    const app = buildApp();
    const res = await request(app)
      .put("/api/hitl/companies/company-1/checkpoint-schedule")
      .set(auth("user-1"))
      .set("X-Paperclip-Run-Id", "run-1")
      .send({
        timezone: "America/New_York",
        weeklyReview: { dayOfWeek: 4, hour: 15 },
        kpiDeviation: {
          thresholds: [
            {
              metricKey: "pipeline_coverage",
              comparator: "lt",
              threshold: 2.5,
              window: "week",
            },
          ],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.schedule.timezone).toBe("America/New_York");
    expect(res.body.schedule.weeklyReview.dayOfWeek).toBe(4);
    expect(res.body.schedule.kpiDeviation.thresholds).toHaveLength(1);
  });

  it("creates a checkpoint when a KPI deviation breaches the configured threshold", async () => {
    const app = buildApp();
    await request(app)
      .put("/api/hitl/companies/company-1/checkpoint-schedule")
      .set(auth("user-1"))
      .set("X-Paperclip-Run-Id", "run-1")
      .send({
        kpiDeviation: {
          thresholds: [
            {
              metricKey: "weekly_signups",
              comparator: "lt",
              threshold: 100,
              window: "week",
            },
          ],
        },
      });

    const res = await request(app)
      .post("/api/hitl/companies/company-1/checkpoints/evaluate-trigger")
      .set(auth("user-1"))
      .set("X-Paperclip-Run-Id", "run-2")
      .send({
        triggerType: "kpi_deviation",
        recipientType: "agent",
        recipientId: "ceo-agent",
        event: {
          metricKey: "weekly_signups",
          observedValue: 74,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(true);
    expect(res.body.checkpoint.triggerType).toBe("kpi_deviation");

    const notifications = await request(app)
      .get("/api/hitl/companies/company-1/notifications?recipientType=agent&recipientId=ceo-agent")
      .set(auth("user-1"));

    expect(notifications.status).toBe(200);
    expect(notifications.body.total).toBeGreaterThan(0);
    expect(notifications.body.notifications[0].kind).toBe("checkpoint");
  });

  it("routes inline artifact comments to the responsible agent", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/hitl/companies/company-1/artifact-comments")
      .set(auth("user-1"))
      .set("X-Paperclip-Run-Id", "run-3")
      .send({
        artifact: {
          kind: "document",
          id: "prd-1",
          title: "Launch PRD",
          path: "/docs/prd.md",
        },
        anchor: {
          quote: "Ask the CEO should include citations",
          lineStart: 18,
          lineEnd: 18,
        },
        body: "Please add the company-state evidence block before this ships.",
        routing: {
          recipientType: "agent",
          recipientId: "backend-engineer",
          responsibleAgentId: "backend-engineer",
          reason: "Backend owns the Ask the CEO response contract.",
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.comment.routing.responsibleAgentId).toBe("backend-engineer");

    const comments = await request(app)
      .get("/api/hitl/companies/company-1/artifact-comments?artifactId=prd-1")
      .set(auth("user-1"));

    expect(comments.status).toBe(200);
    expect(comments.body.total).toBe(1);
    expect(comments.body.comments[0].anchor.lineStart).toBe(18);
  });

  it("returns company state and Ask the CEO responses with cited entities", async () => {
    const app = buildApp();
    const team = await controlPlaneStore.createTeam({
      userId: "user-1",
      name: "AutoFlow Build",
      budgetMonthlyUsd: 5000,
      orchestrationEnabled: true,
    });
    controlPlaneStore.createTask({
      userId: "user-1",
      teamId: team.id,
      title: "Ship HITL contracts",
      actor: "user-1",
    });

    await request(app)
      .post(`/api/hitl/companies/${team.id}/checkpoints`)
      .set(auth("user-1"))
      .set("X-Paperclip-Run-Id", "run-4")
      .send({
        triggerType: "manual",
        title: "Review HITL backlog",
        recipientType: "user",
        recipientId: "user-1",
      });

    const ask = await request(app)
      .post(`/api/hitl/companies/${team.id}/ask-ceo/requests`)
      .set(auth("user-1"))
      .set("X-Paperclip-Run-Id", "run-5")
      .send({
        question: "What needs my attention right now?",
      });

    expect(ask.status).toBe(201);
    expect(ask.body.request.status).toBe("answered");
    expect(
      ask.body.request.response.citedEntities.some((entity: { type: string }) => entity.type === "team")
    ).toBe(true);

    const state = await request(app)
      .get(`/api/hitl/companies/${team.id}/state`)
      .set(auth("user-1"));

    expect(state.status).toBe(200);
    expect(state.body.summary.team.name).toBe("AutoFlow Build");
    expect(state.body.summary.hitl.openCheckpointCount).toBe(1);
    expect(state.body.askCeoRequests).toHaveLength(1);
  });

  it("requires X-Paperclip-Run-Id on mutating requests", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/hitl/companies/company-1/ask-ceo/requests")
      .set(auth("user-1"))
      .send({ question: "hello" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/X-Paperclip-Run-Id/i);
  });
});
