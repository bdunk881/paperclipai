import express from "express";
import request from "supertest";
import { agentMemoryStore } from "../agents/agentMemoryStore";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { subscriptionStore } from "../billing/subscriptionStore";
import { runTicketNotificationSweep } from "../engine/ticketSlaCoordinator";
import { ticketNotificationStore } from "./ticketNotificationStore";
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
    req.auth = {
      sub: authHeader.slice(7),
      email: "test@example.com",
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    next();
  });
  app.use((req: WorkspaceAwareRequest, _res, next) => {
    const headerWorkspaceId =
      typeof req.headers["x-workspace-id"] === "string" ? req.headers["x-workspace-id"].trim() : "";
    const queryWorkspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId.trim() : "";
    req.workspaceId = headerWorkspaceId || req.auth?.workspaceId || queryWorkspaceId || "";
    next();
  });
  app.use("/api/tickets", ticketRoutes);
  return app;
}

function grantPlan(userId: string, tier: "flow" | "automate" | "scale") {
  subscriptionStore.upsert({
    id: `sub-${userId}`,
    stripeSubscriptionId: `stripe-sub-${userId}`,
    stripeCustomerId: `stripe-customer-${userId}`,
    userId,
    email: `${userId}@example.com`,
    tier,
    accessLevel: "active",
    status: "active",
    currentPeriodStart: "2026-04-01T00:00:00.000Z",
    currentPeriodEnd: "2026-05-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    trialEnd: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });
}

describe("ticket routes", () => {
  beforeEach(async () => {
    await ticketStore.clear();
    agentMemoryStore.clear();
    subscriptionStore.clear();
    await ticketNotificationStore.clear();
    jest.restoreAllMocks();
  });

  it("creates a ticket with a primary assignee and collaborator", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-create")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "Missing header",
      assignees: [{ type: "user", id: "creator-1", role: "primary" }],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/X-Paperclip-Run-Id/i);
  });

  it("rejects mismatched workspace IDs when resolver context differs from the payload", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-workspace-mismatch")
      .set("X-Workspace-Id", "22222222-2222-4222-8222-222222222222")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Workspace mismatch",
        assignees: [{ type: "user", id: "creator-1", role: "primary" }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/workspaceId does not match/i);
  });

  it("lists queue tickets for a specific actor with filters", async () => {
    const app = buildTestApp();
    const createOne = await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-queue-1")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Primary backend task",
        priority: "high",
        assignees: [{ type: "agent", id: "backend-engineer", role: "primary" }],
      });

    await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-queue-2")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Other queue item",
        priority: "low",
        assignees: [{ type: "agent", id: "frontend-engineer", role: "primary" }],
      });

    expect(createOne.status).toBe(201);

    const res = await request(app)
      .get(
        "/api/tickets/queue/agent/backend-engineer?workspaceId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&priority=high"
      )
      .set(auth("creator-1"));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.tickets[0].title).toBe("Primary backend task");
  });

  it("returns default SLA policies and lets callers update one", async () => {
    const app = buildTestApp();

    const list = await request(app)
      .get("/api/tickets/sla/policies?workspaceId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .set(auth("creator-1"));

    expect(list.status).toBe(200);
    expect(list.body.total).toBe(4);
    expect(list.body.policies.find((policy: { priority: string }) => policy.priority === "urgent")).toBeTruthy();

    const updated = await request(app)
      .put("/api/tickets/sla/policies/high")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-policy-update")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        firstResponseTarget: { kind: "minutes", value: 45 },
        resolutionTarget: { kind: "business_days", value: 2 },
        escalation: {
          notify: true,
          autoBumpPriority: true,
          autoReassign: true,
          fallbackAssignee: { type: "agent", id: "escalation-agent" },
        },
      });

    expect(updated.status).toBe(200);
    expect(updated.body.policy.firstResponseTarget.value).toBe(45);
    expect(updated.body.policy.escalation.autoReassign).toBe(true);
  });

  it("returns live SLA settings payload and persists dashboard edits", async () => {
    const app = buildTestApp();

    const initial = await request(app)
      .get("/api/tickets/sla/settings?workspaceId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .set(auth("creator-1"));

    expect(initial.status).toBe(200);
    expect(initial.body.policies).toHaveLength(4);
    expect(initial.body.escalationRules).toHaveLength(4);
    expect(Array.isArray(initial.body.fallbackCandidates)).toBe(true);

    const updated = await request(app)
      .patch("/api/tickets/sla/settings")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-sla-settings")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        policies: [
          { priority: "urgent", firstResponseMinutes: 15, resolutionMinutes: 240 },
          { priority: "high", firstResponseMinutes: 45, resolutionMinutes: 1440 },
          { priority: "medium", firstResponseMinutes: 240, resolutionMinutes: 4320 },
          { priority: "low", firstResponseMinutes: 1440, resolutionMinutes: 10080 },
        ],
        escalationRules: [
          {
            priority: "urgent",
            notifyTargets: ["@CTO", "#incident-room"],
            autoBumpPriority: false,
            autoReassign: true,
            fallbackActor: { type: "agent", id: "cto-agent" },
          },
          {
            priority: "high",
            notifyTargets: ["ops@autoflow.ai"],
            autoBumpPriority: true,
            autoReassign: false,
          },
          {
            priority: "medium",
            notifyTargets: [],
            autoBumpPriority: false,
            autoReassign: false,
          },
          {
            priority: "low",
            notifyTargets: [],
            autoBumpPriority: false,
            autoReassign: false,
          },
        ],
      });

    expect(updated.status).toBe(200);
    expect(updated.body.policies.find((row: { priority: string }) => row.priority === "high")).toMatchObject({
      firstResponseMinutes: 45,
      resolutionMinutes: 1440,
    });
    expect(
      updated.body.escalationRules.find((row: { priority: string }) => row.priority === "urgent")
    ).toMatchObject({
      notifyTargets: ["@CTO", "#incident-room"],
      autoReassign: true,
      fallbackActor: { type: "agent", id: "cto-agent" },
    });

    const persisted = await request(app)
      .get("/api/tickets/sla/settings?workspaceId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .set(auth("creator-1"));

    expect(persisted.status).toBe(200);
    expect(
      persisted.body.escalationRules.find((row: { priority: string }) => row.priority === "urgent")
    ).toMatchObject({
      notifyTargets: ["@CTO", "#incident-room"],
      fallbackActor: { type: "agent", id: "cto-agent" },
    });

    const policies = await request(app)
      .get("/api/tickets/sla/policies?workspaceId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .set(auth("creator-1"));

    expect(policies.status).toBe(200);
    expect(policies.body.policies.find((row: { priority: string }) => row.priority === "high")).toMatchObject({
      firstResponseTarget: { kind: "minutes", value: 45 },
      resolutionTarget: { kind: "minutes", value: 1440 },
    });
    expect(policies.body.policies.find((row: { priority: string }) => row.priority === "low")).toMatchObject({
      firstResponseTarget: { kind: "minutes", value: 1440 },
      resolutionTarget: { kind: "minutes", value: 10080 },
    });
  });

  it("bulk patches SLA policies and returns settings payload shape", async () => {
    const app = buildTestApp();

    const updated = await request(app)
      .patch("/api/tickets/sla/policies")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-policy-bulk-patch")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        policies: [
          { priority: "urgent", firstResponseMinutes: 10, resolutionMinutes: 120 },
          { priority: "high", firstResponseMinutes: 45, resolutionMinutes: 1440 },
          { priority: "medium", firstResponseMinutes: 180, resolutionMinutes: 4320 },
          { priority: "low", firstResponseMinutes: 1440, resolutionMinutes: 10080 },
        ],
        escalationRules: [
          { priority: "urgent", notifyTargets: ["@cto"], autoBumpPriority: true, autoReassign: true },
        ],
      });

    expect(updated.status).toBe(200);
    expect(updated.body.policies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ priority: "high", firstResponseMinutes: 45, resolutionMinutes: 1440 }),
      ])
    );
    expect(updated.body.escalationRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ priority: "urgent", notifyTargets: [] }),
      ])
    );
    expect(Array.isArray(updated.body.fallbackCandidates)).toBe(true);
    expect(typeof updated.body.updatedAt).toBe("string");

    const persisted = await request(app)
      .get("/api/tickets/sla/policies?workspaceId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .set(auth("creator-1"));

    expect(persisted.status).toBe(200);
    expect(persisted.body.policies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          priority: "urgent",
          firstResponseTarget: { kind: "minutes", value: 10 },
          resolutionTarget: { kind: "minutes", value: 120 },
        }),
        expect.objectContaining({
          priority: "low",
          firstResponseTarget: { kind: "minutes", value: 1440 },
          resolutionTarget: { kind: "minutes", value: 10080 },
        }),
      ])
    );
  });

  it("rejects bulk SLA patch requests when policies is not an array", async () => {
    const app = buildTestApp();

    const res = await request(app)
      .patch("/api/tickets/sla/policies")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-policy-bulk-invalid")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        policies: { priority: "urgent", firstResponseMinutes: 10, resolutionMinutes: 120 },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/array/i);
  });

  it("allows the primary assignee to transition the ticket and logs activity", async () => {
    const app = buildTestApp();
    const created = await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-transition-create")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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

  it("enqueues notifications for assignments, mentions, and close requests", async () => {
    const app = buildTestApp();
    const created = await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-notify-create")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Notification fanout",
        assignees: [
          { type: "agent", id: "backend-agent", role: "primary" },
          { type: "user", id: "creator-1", role: "collaborator" },
        ],
      });

    await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/updates`)
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-notify-mention")
      .send({
        type: "comment",
        content: "Please investigate this quickly.",
        actorType: "user",
        metadata: {
          mentions: [{ type: "agent", id: "backend-agent" }],
          readyToClose: true,
        },
      });

    const assignmentNotifications = await ticketNotificationStore.list({
      recipientType: "agent",
      recipientId: "backend-agent",
    });
    expect(assignmentNotifications.some((notification) => notification.kind === "assignment")).toBe(true);
    expect(assignmentNotifications.some((notification) => notification.kind === "mention")).toBe(true);

    const creatorNotifications = await request(app)
      .get("/api/tickets/notifications")
      .set(auth("creator-1"));
    expect(creatorNotifications.status).toBe(200);
    expect(creatorNotifications.body.notifications.some((notification: { kind: string }) => notification.kind === "assignment")).toBe(true);
  });

  it("persists child ticket links and mirrors child activity onto the parent", async () => {
    const app = buildTestApp();
    const parent = await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-parent-create")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Parent ticket",
        assignees: [{ type: "agent", id: "backend-agent", role: "primary" }],
      });

    const child = await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-child-create")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        parentId: parent.body.ticket.id,
        title: "Child ticket",
        assignees: [{ type: "agent", id: "backend-agent", role: "primary" }],
      });

    expect(child.status).toBe(201);
    expect(child.body.ticket.parentId).toBe(parent.body.ticket.id);

    const children = await request(app)
      .get(`/api/tickets/${parent.body.ticket.id}/children`)
      .set(auth("creator-1"));

    expect(children.status).toBe(200);
    expect(children.body.total).toBe(1);
    expect(children.body.tickets[0].id).toBe(child.body.ticket.id);

    await request(app)
      .post(`/api/tickets/${child.body.ticket.id}/transitions`)
      .set(auth("backend-agent"))
      .set("X-Paperclip-Run-Id", "run-ticket-child-progress")
      .send({ status: "in_progress", actorType: "agent" });

    const parentActivity = await request(app)
      .get(`/api/tickets/${parent.body.ticket.id}/activity`)
      .set(auth("creator-1"));

    expect(parentActivity.status).toBe(200);
    expect(parentActivity.body.updates.some((update: { metadata: Record<string, unknown> }) =>
      update.metadata.event === "child_ticket_created" &&
      update.metadata.childTicketId === child.body.ticket.id,
    )).toBe(true);
    expect(parentActivity.body.updates.some((update: { metadata: Record<string, unknown> }) =>
      update.metadata.event === "child_ticket_status_changed" &&
      update.metadata.childTicketId === child.body.ticket.id &&
      update.metadata.toStatus === "in_progress",
    )).toBe(true);
  });

  it("writes ready-to-close audit updates for collaborator requests and primary decisions", async () => {
    const app = buildTestApp();
    const created = await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-ready-create")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Ready to close coverage",
        assignees: [
          { type: "agent", id: "backend-agent", role: "primary" },
          { type: "user", id: "creator-1", role: "collaborator" },
        ],
      });

    const requested = await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/updates`)
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-ready-request")
      .send({
        type: "comment",
        content: "Work looks complete to me.",
        actorType: "user",
        metadata: { readyToClose: true },
      });

    expect(requested.status).toBe(201);

    const approved = await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/updates`)
      .set(auth("backend-agent"))
      .set("X-Paperclip-Run-Id", "run-ticket-ready-approve")
      .send({
        type: "structured_update",
        content: "Confirmed close readiness.",
        actorType: "agent",
        metadata: { readyToCloseDecision: "approved" },
      });

    expect(approved.status).toBe(201);

    const ticket = await request(app)
      .get(`/api/tickets/${created.body.ticket.id}`)
      .set(auth("creator-1"));

    expect(ticket.status).toBe(200);
    expect(ticket.body.updates.some((update: { metadata: Record<string, unknown> }) =>
      update.metadata.event === "ready_to_close_requested",
    )).toBe(true);
    expect(ticket.body.updates.some((update: { metadata: Record<string, unknown> }) =>
      update.metadata.event === "ready_to_close_approved" &&
      update.metadata.decision === "approved",
    )).toBe(true);
  });

  it("evaluates SLA state, breaches tickets, and applies escalation rules", async () => {
    const app = buildTestApp();

    await request(app)
      .put("/api/tickets/sla/policies/medium")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-sla-policy")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        firstResponseTarget: { kind: "minutes", value: 1 },
        resolutionTarget: { kind: "minutes", value: 1 },
        escalation: {
          notify: true,
          autoBumpPriority: true,
          autoReassign: true,
          fallbackAssignee: { type: "agent", id: "cto-agent" },
        },
      });

    const created = await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-sla-create")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "SLA breach coverage",
        priority: "medium",
        assignees: [{ type: "agent", id: "backend-agent", role: "primary" }],
      });

    const evaluated = await request(app)
      .post("/api/tickets/sla/evaluate")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-sla-evaluate")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        now: "2030-01-01T00:10:00.000Z",
      });

    expect(evaluated.status).toBe(200);
    expect(evaluated.body.evaluated).toBeGreaterThan(0);

    const ticket = await request(app).get(`/api/tickets/${created.body.ticket.id}`).set(auth("creator-1"));
    expect(ticket.status).toBe(200);
    expect(ticket.body.ticket.slaState).toBe("breached");
    expect(ticket.body.ticket.priority).toBe("high");
    expect(ticket.body.ticket.assignees[0]).toMatchObject({ type: "agent", id: "cto-agent", role: "primary" });

    const sweep = await runTicketNotificationSweep();
    expect(sweep.delivered).toBeGreaterThan(0);
  });

  it("returns relevant ticket_close memories when an agent starts a ticket", async () => {
    grantPlan("creator-1", "flow");
    const app = buildTestApp();

    await agentMemoryStore.createTicketCloseEntry({
      userId: "creator-1",
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agentId: "backend-agent",
      runId: "run-memory-seed",
      ticketId: "ALT-42",
      ticketUrl: "/tickets/ALT-42",
      closedAt: "2026-04-10T00:00:00.000Z",
      taskSummary: "Resolved billing export mismatch for a queue ticket.",
      agentContribution: "Patched the invoice aggregation path and verified the backfill.",
      keyLearnings: "Billing regressions usually surface in queue and reconciliation workflows.",
      artifactRefs: ["https://example.com/billing-runbook"],
      tags: ["billing", "queue"],
      tier: "flow",
    });

    const created = await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-memory-create")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Investigate billing queue mismatch",
        description: "The billing queue shows duplicate reconciliation rows.",
        tags: ["billing", "queue"],
        assignees: [{ type: "agent", id: "backend-agent", role: "primary" }],
      });

    const started = await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/transitions`)
      .set(auth("backend-agent"))
      .set("X-Paperclip-Run-Id", "run-ticket-memory-start")
      .send({ status: "in_progress", actorType: "agent" });

    expect(started.status).toBe(200);
    expect(started.body.ticket.status).toBe("in_progress");
    expect(started.body.relevantMemories).toHaveLength(1);
    expect(started.body.relevantMemories[0].entry.entryType).toBe("ticket_close");
    expect(started.body.relevantMemories[0].entry.metadata.ticket_id).toBe("ALT-42");
  });

  it("writes a ticket_close memory for every agent assignee on resolve", async () => {
    grantPlan("creator-1", "flow");
    const app = buildTestApp();

    const created = await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-close-create")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Close hook coverage",
        description: "Need per-agent memory writes on resolve.",
        tags: ["memory", "close-hook"],
        assignees: [
          { type: "agent", id: "backend-agent", role: "primary" },
          { type: "agent", id: "qa-agent", role: "collaborator" },
        ],
      });

    await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/updates`)
      .set(auth("backend-agent"))
      .set("X-Paperclip-Run-Id", "run-ticket-close-update-1")
      .send({ type: "structured_update", content: "Implemented the close hook.", actorType: "agent", metadata: { artifactRefs: ["https://example.com/pr/1699"] } });

    await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/updates`)
      .set(auth("qa-agent"))
      .set("X-Paperclip-Run-Id", "run-ticket-close-update-2")
      .send({ type: "structured_update", content: "Validated the retry behavior in tests.", actorType: "agent" });

    await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/transitions`)
      .set(auth("backend-agent"))
      .set("X-Paperclip-Run-Id", "run-ticket-close-progress")
      .send({ status: "in_progress", actorType: "agent" });

    const resolved = await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/transitions`)
      .set(auth("backend-agent"))
      .set("X-Paperclip-Run-Id", "run-ticket-close-resolve")
      .send({
        status: "resolved",
        actorType: "agent",
        reason: "Ticket complete",
        memoryEntries: [
          {
            agentId: "backend-agent",
            taskSummary: "Implemented ticket close memory hooks.",
            agentContribution: "Added the resolved transition writer and retrieval path.",
            keyLearnings: "Ticket-close memories should stay on the existing agent memory rail.",
            artifactRefs: ["https://example.com/pr/1699"],
            tags: ["memory", "close-hook"],
          },
          {
            agentId: "qa-agent",
            taskSummary: "Validated ticket close memory behavior.",
            agentContribution: "Exercised the multi-agent resolve flow.",
            keyLearnings: "Retry coverage needs both failure logging and eventual success paths.",
            tags: ["memory", "qa"],
          },
        ],
      });

    expect(resolved.status).toBe(200);
    expect(resolved.body.ticket.status).toBe("resolved");
    expect(resolved.body.closeContract).toMatchObject({
      ticketId: created.body.ticket.id,
      ticketUrl: `/tickets/${created.body.ticket.id}`,
      assignees: {
        all: [
          { type: "agent", id: "backend-agent", role: "primary" },
          { type: "agent", id: "qa-agent", role: "collaborator" },
        ],
        primary: { type: "agent", id: "backend-agent", role: "primary" },
        collaborators: [{ type: "agent", id: "qa-agent", role: "collaborator" }],
      },
      hooks: [
        {
          hook: "agent_memory_ticket_close",
          delivery: "non_blocking",
          status: "completed",
          agentId: "backend-agent",
          attempts: 1,
        },
        {
          hook: "agent_memory_ticket_close",
          delivery: "non_blocking",
          status: "completed",
          agentId: "qa-agent",
          attempts: 1,
        },
      ],
    });
    expect(resolved.body.closeContract.closedAt).toBe(resolved.body.ticket.resolvedAt);

    const backendMemories = await agentMemoryStore.searchEntries({
      userId: "creator-1",
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agentId: "backend-agent",
      query: "close hook",
      entryType: "ticket_close",
      tags: ["memory"],
    });
    const qaMemories = await agentMemoryStore.searchEntries({
      userId: "creator-1",
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agentId: "qa-agent",
      query: "multi-agent",
      entryType: "ticket_close",
      tags: ["memory", "qa"],
    });

    expect(backendMemories).toHaveLength(1);
    expect(backendMemories[0].entry.metadata.ticket_id).toBe(created.body.ticket.id);
    expect(qaMemories).toHaveLength(1);
    expect(qaMemories[0].entry.metadata.ticket_id).toBe(created.body.ticket.id);
  });

  it("logs and retries failed ticket_close writes without blocking resolution", async () => {
    grantPlan("creator-1", "flow");
    const app = buildTestApp();

    const created = await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-retry-create")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Retry queue coverage",
        assignees: [{ type: "agent", id: "backend-agent", role: "primary" }],
      });

    await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/transitions`)
      .set(auth("backend-agent"))
      .set("X-Paperclip-Run-Id", "run-ticket-retry-progress")
      .send({ status: "in_progress", actorType: "agent" });

    const createSpy = jest.spyOn(agentMemoryStore, "createTicketCloseEntry");
    createSpy
      .mockRejectedValueOnce(new Error("temporary embedding outage"))
      .mockRejectedValueOnce(new Error("temporary embedding outage"));

    const resolved = await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/transitions`)
      .set(auth("backend-agent"))
      .set("X-Paperclip-Run-Id", "run-ticket-retry-resolve")
      .send({
        status: "resolved",
        actorType: "agent",
        memoryEntries: [
          {
            agentId: "backend-agent",
            taskSummary: "Attempted the resolve flow.",
            agentContribution: "Triggered the close hook path.",
            keyLearnings: "Transient embedding failures must not block ticket closure.",
            tags: ["memory"],
          },
        ],
      });

    expect(resolved.status).toBe(200);
    expect(resolved.body.ticket.status).toBe("resolved");
    expect(ticketStore.pendingTicketCloseMemoryWriteCountForTests()).toBe(1);
    expect(resolved.body.updates.at(-1).metadata.event).toBe("ticket_memory_retry_queued");
    expect(resolved.body.closeContract).toMatchObject({
      assignees: {
        primary: { type: "agent", id: "backend-agent", role: "primary" },
        collaborators: [],
      },
      hooks: [
        {
          hook: "agent_memory_ticket_close",
          delivery: "non_blocking",
          status: "queued_for_retry",
          agentId: "backend-agent",
          attempts: 2,
          error: "temporary embedding outage",
        },
      ],
    });

    createSpy.mockRestore();
    await ticketStore.retryPendingTicketCloseMemoryWrites();

    expect(ticketStore.pendingTicketCloseMemoryWriteCountForTests()).toBe(0);
    const memories = await agentMemoryStore.searchEntries({
      userId: "creator-1",
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agentId: "backend-agent",
      query: "transient embedding failures",
      entryType: "ticket_close",
      tags: ["memory"],
    });
    expect(memories).toHaveLength(1);
  });

  it("derives ticket_close memories on resolve when explicit memoryEntries are omitted", async () => {
    grantPlan("creator-1", "flow");
    const app = buildTestApp();

    const created = await request(app)
      .post("/api/tickets")
      .set(auth("creator-1"))
      .set("X-Paperclip-Run-Id", "run-ticket-derived-create")
      .send({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Derived memory coverage",
        description: "Ensure resolved tickets can infer memory payloads from ticket context.",
        tags: ["memory", "derived"],
        assignees: [{ type: "agent", id: "backend-agent", role: "primary" }],
      });

    await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/transitions`)
      .set(auth("backend-agent"))
      .set("X-Paperclip-Run-Id", "run-ticket-derived-progress")
      .send({ status: "in_progress", actorType: "agent" });

    await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/updates`)
      .set(auth("backend-agent"))
      .set("X-Paperclip-Run-Id", "run-ticket-derived-update")
      .send({
        type: "structured_update",
        content: "Patched the inferred ticket-close memory path and validated the fallback content.",
        actorType: "agent",
      });

    const resolved = await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/transitions`)
      .set(auth("backend-agent"))
      .set("X-Paperclip-Run-Id", "run-ticket-derived-resolve")
      .send({
        status: "resolved",
        actorType: "agent",
        reason: "Resolved with derived memory entry",
      });

    expect(resolved.status).toBe(200);
    expect(resolved.body.ticket.status).toBe("resolved");
    expect(resolved.body.updates.at(-1).metadata.event).toBe("ticket_memory_logged");
    expect(resolved.body.closeContract).toMatchObject({
      assignees: {
        all: [{ type: "agent", id: "backend-agent", role: "primary" }],
        primary: { type: "agent", id: "backend-agent", role: "primary" },
        collaborators: [],
      },
      hooks: [
        {
          hook: "agent_memory_ticket_close",
          delivery: "non_blocking",
          status: "completed",
          agentId: "backend-agent",
          attempts: 1,
        },
      ],
    });

    const memories = await agentMemoryStore.searchEntries({
      userId: "creator-1",
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agentId: "backend-agent",
      query: "inferred ticket-close memory path",
      entryType: "ticket_close",
      tags: ["memory", "derived"],
      ticketId: created.body.ticket.id,
    });

    expect(memories).toHaveLength(1);
    expect(memories[0].entry.metadata.ticket_id).toBe(created.body.ticket.id);
  });
});
