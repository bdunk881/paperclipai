import express from "express";
import request from "supertest";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import ticketRoutes from "./ticketRoutes";
import { ticketStore } from "./ticketStore";

function auth(userId: string) {
  return { Authorization: `Bearer ${userId}` };
}

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req: AuthenticatedRequest, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or malformed Authorization header." });
      return;
    }
    req.auth = { sub: authHeader.slice(7), email: "test@example.com" };
    next();
  });
  app.use("/api/tickets", ticketRoutes);
  return app;
}

describe("ticket routes", () => {
  beforeEach(async () => {
    await ticketStore.clear();
  });

  it("creates a ticket with a primary assignee and collaborator", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-create")
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        title: "Investigate agent handoff regression",
        description: "Need durable ticketing backend support.",
        priority: "high",
        assignees: [
          { type: "agent", id: "backend-engineer", role: "primary" },
          { type: "user", id: "pm-1", role: "collaborator" },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.ticket.status).toBe("open");
    expect(res.body.ticket.assignees).toHaveLength(2);
    expect(res.body.updates).toHaveLength(1);
    expect(res.body.updates[0].metadata.event).toBe("created");
  });

  it("requires X-Paperclip-Run-Id on ticket mutations", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/tickets").set(auth("creator-1")).send({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      title: "Missing header",
      assignees: [{ type: "user", id: "creator-1", role: "primary" }],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/X-Paperclip-Run-Id/i);
  });

  it("lists queue tickets for a specific actor with filters", async () => {
    const app = buildTestApp();
    const createOne = await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-queue-1")
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        title: "Primary backend task",
        priority: "high",
        assignees: [{ type: "agent", id: "backend-engineer", role: "primary" }],
      });

    await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-queue-2")
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        title: "Other queue item",
        priority: "low",
        assignees: [{ type: "agent", id: "frontend-engineer", role: "primary" }],
      });

    expect(createOne.status).toBe(201);

    const res = await request(app)
      .get(
        "/api/tickets/queue/agent/backend-engineer?workspaceId=11111111-1111-4111-8111-111111111111&priority=high"
      )
      .set(auth("creator-1"));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.tickets[0].title).toBe("Primary backend task");
  });

  it("allows the primary assignee to transition the ticket and logs activity", async () => {
    const app = buildTestApp();
    const created = await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-transition-create")
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        title: "Status transition coverage",
        assignees: [{ type: "user", id: "creator-1", role: "primary" }],
      });

    const ticketId = created.body.ticket.id;

    const inProgress = await request(app)
      .post(`/api/tickets/${ticketId}/transitions`)
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-transition-open")
      .send({ status: "in_progress", actorType: "user" });

    expect(inProgress.status).toBe(200);
    expect(inProgress.body.ticket.status).toBe("in_progress");

    const resolved = await request(app)
      .post(`/api/tickets/${ticketId}/transitions`)
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-transition-resolve")
      .send({ status: "resolved", actorType: "user", reason: "Work completed" });

    expect(resolved.status).toBe(200);
    expect(resolved.body.ticket.status).toBe("resolved");

    const activity = await request(app).get(`/api/tickets/${ticketId}/activity`).set(auth("creator-1"));
    expect(activity.status).toBe(200);
    expect(activity.body.total).toBe(3);
    expect(activity.body.updates[2].type).toBe("status_change");
    expect(activity.body.updates[2].metadata.toStatus).toBe("resolved");
  });

  it("rejects transitions from non-primary actors", async () => {
    const app = buildTestApp();
    const created = await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-forbidden-create")
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        title: "Forbidden transition",
        assignees: [
          { type: "user", id: "owner-1", role: "primary" },
          { type: "user", id: "collab-1", role: "collaborator" },
        ],
      });

    const res = await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/transitions`)
      .set(auth("collab-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-forbidden-transition")
      .send({ status: "in_progress", actorType: "user" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/primary assignee/i);
  });

  it("rejects invalid transitions", async () => {
    const app = buildTestApp();
    const created = await request(app)
      .post("/api/tickets")
      .set(auth("owner-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-invalid-create")
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        title: "Invalid transition",
        assignees: [{ type: "user", id: "owner-1", role: "primary" }],
      });

    const res = await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/transitions`)
      .set(auth("owner-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-invalid-transition")
      .send({ status: "resolved", actorType: "user" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Invalid ticket state transition/i);
  });

  it("appends comment updates to the activity stream", async () => {
    const app = buildTestApp();
    const created = await request(app)
      .post("/api/tickets")
      .set(auth("owner-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-update-create")
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        title: "Activity stream",
        assignees: [{ type: "user", id: "owner-1", role: "primary" }],
      });

    const update = await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/updates`)
      .set(auth("owner-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-update-write")
      .send({ type: "comment", content: "Investigating root cause now.", actorType: "user" });

    expect(update.status).toBe(201);
    expect(update.body.update.type).toBe("comment");

    const ticket = await request(app).get(`/api/tickets/${created.body.ticket.id}`).set(auth("owner-1"));
    expect(ticket.status).toBe(200);
    expect(ticket.body.updates).toHaveLength(2);
    expect(ticket.body.updates[1].content).toMatch(/Investigating root cause now/i);
  });
});
