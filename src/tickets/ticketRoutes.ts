import { NextFunction, Response, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import {
  TicketActorType,
  TicketAssignee,
  TicketPriority,
  TicketStatus,
  TicketUpdateType,
  ticketStore,
} from "./ticketStore";
import { ticketSyncService } from "../ticketSync/service";

const router = Router();

const actorTypeSchema = z.enum(["agent", "user"]);
const ticketPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
const ticketStatusSchema = z.enum(["open", "in_progress", "resolved", "blocked", "cancelled"]);
const ticketUpdateTypeSchema = z.enum(["comment", "status_change", "structured_update"]);
const slaTargetSchema = z.object({
  kind: z.enum(["minutes", "business_days"]),
  value: z.number().int().positive(),
});
const notificationChannelSchema = z.enum(["inbox", "email", "agent_wake"]);
const notificationStatusSchema = z.enum(["pending", "sent", "failed"]);

const assigneeSchema = z.object({
  type: actorTypeSchema,
  id: z.string().trim().min(1),
  role: z.enum(["primary", "collaborator"]),
});

const createTicketSchema = z.object({
  workspaceId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000).optional(),
  priority: ticketPrioritySchema.optional(),
  dueDate: z.string().datetime().optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(25).optional(),
  assignees: z.array(assigneeSchema).min(1),
});

const updateTicketSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(10000).optional(),
    priority: ticketPrioritySchema.optional(),
    dueDate: z.string().datetime().nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(25).optional(),
    assignees: z.array(assigneeSchema).min(1).optional(),
    actorType: actorTypeSchema.optional(),
  })
  .refine((value) => {
    return (
      value.title !== undefined ||
      value.description !== undefined ||
      value.priority !== undefined ||
      value.dueDate !== undefined ||
      value.tags !== undefined ||
      value.assignees !== undefined
    );
  }, "At least one mutable ticket field is required");

const createUpdateSchema = z.object({
  type: ticketUpdateTypeSchema.default("comment"),
  content: z.string().trim().min(1).max(10000),
  metadata: z.record(z.unknown()).optional(),
  actorType: actorTypeSchema.optional(),
});

const transitionSchema = z.object({
  status: ticketStatusSchema,
  reason: z.string().trim().max(5000).optional(),
  actorType: actorTypeSchema.optional(),
  memoryEntries: z.array(z.object({
    agentId: z.string().trim().min(1),
    taskSummary: z.string().trim().min(1).max(2000),
    agentContribution: z.string().trim().min(1).max(5000),
    keyLearnings: z.string().trim().min(1).max(5000),
    artifactRefs: z.array(z.string().trim().min(1).max(512)).max(25).optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(25).optional(),
    extensionMetadata: z.record(z.unknown()).optional(),
  })).optional(),
});

const upsertPolicySchema = z.object({
  workspaceId: z.string().uuid(),
  firstResponseTarget: slaTargetSchema,
  resolutionTarget: slaTargetSchema,
  atRiskThreshold: z.number().min(0.5).max(0.99).optional(),
  escalation: z
    .object({
      notify: z.boolean().optional(),
      autoBumpPriority: z.boolean().optional(),
      autoReassign: z.boolean().optional(),
      fallbackAssignee: z
        .object({
          type: actorTypeSchema,
          id: z.string().trim().min(1),
        })
        .optional(),
    })
    .optional(),
});

const evaluateSlaSchema = z.object({
  now: z.string().datetime().optional(),
});

function parseBody<T>(
  schema: z.ZodSchema<T>,
  req: AuthenticatedRequest,
  res: Response
): T | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0]?.message ?? "Invalid request body" });
    return null;
  }
  return result.data;
}

function requireRunId(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const runId = req.header("X-Paperclip-Run-Id");
  if (!runId?.trim()) {
    res.status(400).json({ error: "X-Paperclip-Run-Id header is required for mutating ticket requests" });
    return;
  }
  next();
}

function resolveActor(req: AuthenticatedRequest, actorType?: TicketActorType) {
  const actorId = req.auth?.sub?.trim();
  if (!actorId) {
    return null;
  }
  return {
    type: actorType ?? "user",
    id: actorId,
  };
}

function resolveWorkspaceContext(
  req: WorkspaceAwareRequest,
  res: Response,
  requestedWorkspaceId?: string,
) {
  const userId = req.auth?.sub?.trim();
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return null;
  }

  const workspaceId = req.workspaceId?.trim();
  if (!workspaceId) {
    res.status(500).json({ error: "Workspace context was not resolved for the request" });
    return null;
  }

  if (requestedWorkspaceId && requestedWorkspaceId !== workspaceId) {
    res.status(400).json({ error: "workspaceId does not match the resolved workspace context" });
    return null;
  }

  return { workspaceId, userId };
}

function validateAssignees(assignees: TicketAssignee[]): string | null {
  const primaryCount = assignees.filter((assignee) => assignee.role === "primary").length;
  if (primaryCount !== 1) {
    return "Exactly one primary assignee is required";
  }

  const dedupe = new Set<string>();
  for (const assignee of assignees) {
    const key = `${assignee.type}:${assignee.id}`;
    if (dedupe.has(key)) {
      return "Assignees must be unique per actor";
    }
    dedupe.add(key);
  }

  return null;
}

router.post("/", requireRunId, async (req: WorkspaceAwareRequest, res) => {
  const parsed = parseBody(createTicketSchema, req, res);
  if (!parsed) {
    return;
  }
  const context = resolveWorkspaceContext(req, res, parsed.workspaceId);
  if (!context) {
    return;
  }

  const actor = resolveActor(req, "user");
  if (!actor) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const assigneeError = validateAssignees(parsed.assignees);
  if (assigneeError) {
    res.status(400).json({ error: assigneeError });
    return;
  }

  const aggregate = await ticketStore.create({
    workspaceId: context.workspaceId,
    parentId: parsed.parentId,
    title: parsed.title,
    description: parsed.description,
    creatorId: actor.id,
    priority: parsed.priority,
    dueDate: parsed.dueDate,
    tags: parsed.tags,
    assignees: parsed.assignees,
    context,
  });

  await ticketSyncService.syncTicketCreated(aggregate.ticket, {
    actorType: actor.type,
    actorId: actor.id,
    actorLabel: actor.id,
  });

  res.status(201).json(aggregate);
});

router.get("/", async (req: WorkspaceAwareRequest, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const priority = typeof req.query.priority === "string" ? req.query.priority : undefined;
  const actorType = typeof req.query.actorType === "string" ? req.query.actorType : undefined;
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  const actorId = typeof req.query.actorId === "string" ? req.query.actorId : undefined;
  const slaState = typeof req.query.slaState === "string" ? req.query.slaState : undefined;
  const context = resolveWorkspaceContext(req, res, workspaceId);
  if (!context) {
    return;
  }

  const tickets = await ticketStore.list({
    workspaceId: context.workspaceId,
    actorType: actorTypeSchema.safeParse(actorType).success ? (actorType as TicketActorType) : undefined,
    actorId,
    status: ticketStatusSchema.safeParse(status).success ? (status as TicketStatus) : undefined,
    priority:
      ticketPrioritySchema.safeParse(priority).success ? (priority as TicketPriority) : undefined,
    slaState,
  }, context);

  res.json({ tickets, total: tickets.length });
});

router.get("/sla/policies", async (req: WorkspaceAwareRequest, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  const context = resolveWorkspaceContext(req, res, workspaceId);
  if (!context) {
    return;
  }
  const policies = await ticketStore.listPolicies(context.workspaceId, context);
  res.json({ policies, total: policies.length });
});

router.put("/sla/policies/:priority", requireRunId, async (req: WorkspaceAwareRequest, res) => {
  const priorityResult = ticketPrioritySchema.safeParse(req.params.priority);
  if (!priorityResult.success) {
    res.status(400).json({ error: "priority must be one of low, medium, high, urgent" });
    return;
  }
  const parsed = parseBody(upsertPolicySchema, req, res);
  if (!parsed) {
    return;
  }
  const context = resolveWorkspaceContext(req, res, parsed.workspaceId);
  if (!context) {
    return;
  }
  const policy = await ticketStore.upsertPolicy({
    workspaceId: context.workspaceId,
    priority: priorityResult.data as TicketPriority,
    firstResponseTarget: parsed.firstResponseTarget,
    resolutionTarget: parsed.resolutionTarget,
    atRiskThreshold: parsed.atRiskThreshold,
    escalation: parsed.escalation
      ? {
          notify: parsed.escalation.notify ?? true,
          autoBumpPriority: parsed.escalation.autoBumpPriority ?? false,
          autoReassign: parsed.escalation.autoReassign ?? false,
          fallbackAssignee: parsed.escalation.fallbackAssignee,
        }
      : undefined,
    context,
  });
  res.json({ policy });
});

router.post("/sla/evaluate", requireRunId, async (req: WorkspaceAwareRequest, res) => {
  const parsed = parseBody(evaluateSlaSchema, req, res);
  if (!parsed) {
    return;
  }
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }
  const summary = await ticketStore.evaluateSla({
    workspaceId: context.workspaceId,
    now: parsed.now,
    runId: req.header("X-Paperclip-Run-Id") as string,
    context,
  });
  res.json(summary);
});

router.get("/notifications", async (req: AuthenticatedRequest, res) => {
  const channel = typeof req.query.channel === "string" ? req.query.channel : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const actorType = typeof req.query.actorType === "string" ? req.query.actorType : "user";
  const ticketId = typeof req.query.ticketId === "string" ? req.query.ticketId : undefined;
  const recipientId = req.auth?.sub;
  if (!recipientId) {
    res.status(401).json({ error: "Authenticated actor required" });
    return;
  }
  const notifications = await ticketStore.listNotifications({
    recipientType: actorTypeSchema.safeParse(actorType).success ? (actorType as TicketActorType) : "user",
    recipientId,
    ticketId,
    channel: notificationChannelSchema.safeParse(channel).success
      ? (channel as "inbox" | "email" | "agent_wake")
      : undefined,
    status: notificationStatusSchema.safeParse(status).success
      ? (status as "pending" | "sent" | "failed")
      : undefined,
  });
  res.json({ notifications, total: notifications.length });
});

router.get("/queue/:actorType/:actorId", async (req: WorkspaceAwareRequest, res) => {
  const actorTypeResult = actorTypeSchema.safeParse(req.params.actorType);
  if (!actorTypeResult.success) {
    res.status(400).json({ error: "actorType must be agent or user" });
    return;
  }

  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const priority = typeof req.query.priority === "string" ? req.query.priority : undefined;
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  const slaState = typeof req.query.slaState === "string" ? req.query.slaState : undefined;
  const context = resolveWorkspaceContext(req, res, workspaceId);
  if (!context) {
    return;
  }

  const tickets = await ticketStore.list({
    workspaceId: context.workspaceId,
    actorType: actorTypeResult.data,
    actorId: req.params.actorId,
    status: ticketStatusSchema.safeParse(status).success ? (status as TicketStatus) : undefined,
    priority:
      ticketPrioritySchema.safeParse(priority).success ? (priority as TicketPriority) : undefined,
    slaState,
  }, context);

  res.json({
    actor: { type: actorTypeResult.data, id: req.params.actorId },
    tickets,
    total: tickets.length,
  });
});

router.get("/:id/activity", async (req: WorkspaceAwareRequest, res) => {
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }
  const activity = await ticketStore.listActivity(req.params.id, context);
  if (!activity) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  res.json({ updates: activity, total: activity.length });
});

router.get("/:id/children", async (req: WorkspaceAwareRequest, res) => {
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }
  const aggregate = await ticketStore.get(req.params.id, context);
  if (!aggregate) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  const tickets = await ticketStore.listChildren(req.params.id, context);
  res.json({ tickets, total: tickets.length });
});

router.get("/:id", async (req: WorkspaceAwareRequest, res) => {
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }
  const aggregate = await ticketStore.get(req.params.id, context);
  if (!aggregate) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  res.json(aggregate);
});

router.patch("/:id", requireRunId, async (req: WorkspaceAwareRequest, res) => {
  const parsed = parseBody(updateTicketSchema, req, res);
  if (!parsed) {
    return;
  }

  const actor = resolveActor(req, parsed.actorType);
  if (!actor) {
    res.status(401).json({ error: "Authenticated actor required" });
    return;
  }

  if (parsed.assignees) {
    const assigneeError = validateAssignees(parsed.assignees);
    if (assigneeError) {
      res.status(400).json({ error: assigneeError });
      return;
    }
  }
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }

  const aggregate = await ticketStore.updateTicket({
    ticketId: req.params.id,
    actor,
    title: parsed.title,
    description: parsed.description,
    priority: parsed.priority,
    dueDate: parsed.dueDate,
    tags: parsed.tags,
    assignees: parsed.assignees,
    context,
  });

  if (!aggregate) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  res.json(aggregate);
});

router.post("/:id/updates", requireRunId, async (req: WorkspaceAwareRequest, res) => {
  const parsed = parseBody(createUpdateSchema, req, res);
  if (!parsed) {
    return;
  }

  const actor = resolveActor(req, parsed.actorType);
  if (!actor) {
    res.status(401).json({ error: "Authenticated actor required" });
    return;
  }
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }

  const update = await ticketStore.addUpdate({
    ticketId: req.params.id,
    actor,
    type: parsed.type as TicketUpdateType,
    content: parsed.content,
    metadata: parsed.metadata,
    context,
  });

  if (!update) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  if (update.type === "comment") {
    const aggregate = await ticketStore.get(req.params.id, context);
    if (aggregate) {
      await ticketSyncService.syncTicketComment(aggregate.ticket, update, {
        actorType: actor.type,
        actorId: actor.id,
        actorLabel: actor.id,
      });
    }
  }

  res.status(201).json({ update });
});

router.post("/:id/transitions", requireRunId, async (req: WorkspaceAwareRequest, res) => {
  const parsed = parseBody(transitionSchema, req, res);
  if (!parsed) {
    return;
  }

  const actor = resolveActor(req, parsed.actorType);
  if (!actor) {
    res.status(401).json({ error: "Authenticated actor required" });
    return;
  }
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }

  const result = await ticketStore.transitionTicket({
    ticketId: req.params.id,
    actor,
    status: parsed.status,
    reason: parsed.reason,
    runId: req.header("X-Paperclip-Run-Id") as string,
    memoryEntries: parsed.memoryEntries,
    context,
  });

  if (result.error === "not_found") {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  if (result.error === "forbidden") {
    res.status(403).json({ error: "Only the primary assignee can transition ticket status" });
    return;
  }
  if (result.error === "invalid_transition") {
    res.status(409).json({ error: "Invalid ticket state transition" });
    return;
  }

  if (result.aggregate) {
    await ticketSyncService.syncTicketUpdated(result.aggregate.ticket, {
      actorType: actor.type,
      actorId: actor.id,
      actorLabel: actor.id,
    });
  }

  res.json({
    ...result.aggregate,
    relevantMemories: result.relevantMemories ?? [],
    ...(result.closeContract ? { closeContract: result.closeContract } : {}),
  });
});

export default router;
