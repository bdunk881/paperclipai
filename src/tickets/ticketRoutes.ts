import { NextFunction, Response, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import {
  TicketActorType,
  TicketAssignee,
  TicketPriority,
  TicketStatus,
  TicketUpdateType,
  ticketStore,
} from "./ticketStore";

const router = Router();

const actorTypeSchema = z.enum(["agent", "user"]);
const ticketPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
const ticketStatusSchema = z.enum(["open", "in_progress", "resolved", "blocked", "cancelled"]);
const ticketUpdateTypeSchema = z.enum(["comment", "status_change", "structured_update"]);

const assigneeSchema = z.object({
  type: actorTypeSchema,
  id: z.string().trim().min(1),
  role: z.enum(["primary", "collaborator"]),
});

const createTicketSchema = z.object({
  workspaceId: z.string().uuid(),
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

router.post("/", requireRunId, async (req: AuthenticatedRequest, res) => {
  const parsed = parseBody(createTicketSchema, req, res);
  if (!parsed) {
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
    workspaceId: parsed.workspaceId,
    title: parsed.title,
    description: parsed.description,
    creatorId: actor.id,
    priority: parsed.priority,
    dueDate: parsed.dueDate,
    tags: parsed.tags,
    assignees: parsed.assignees,
  });

  res.status(201).json(aggregate);
});

router.get("/", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const priority = typeof req.query.priority === "string" ? req.query.priority : undefined;
  const actorType = typeof req.query.actorType === "string" ? req.query.actorType : undefined;
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  const actorId = typeof req.query.actorId === "string" ? req.query.actorId : undefined;
  const slaState = typeof req.query.slaState === "string" ? req.query.slaState : undefined;

  const tickets = await ticketStore.list({
    workspaceId,
    actorType: actorTypeSchema.safeParse(actorType).success ? (actorType as TicketActorType) : undefined,
    actorId,
    status: ticketStatusSchema.safeParse(status).success ? (status as TicketStatus) : undefined,
    priority:
      ticketPrioritySchema.safeParse(priority).success ? (priority as TicketPriority) : undefined,
    slaState,
  });

  res.json({ tickets, total: tickets.length });
});

router.get("/queue/:actorType/:actorId", async (req, res) => {
  const actorTypeResult = actorTypeSchema.safeParse(req.params.actorType);
  if (!actorTypeResult.success) {
    res.status(400).json({ error: "actorType must be agent or user" });
    return;
  }

  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const priority = typeof req.query.priority === "string" ? req.query.priority : undefined;
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  const slaState = typeof req.query.slaState === "string" ? req.query.slaState : undefined;

  const tickets = await ticketStore.list({
    workspaceId,
    actorType: actorTypeResult.data,
    actorId: req.params.actorId,
    status: ticketStatusSchema.safeParse(status).success ? (status as TicketStatus) : undefined,
    priority:
      ticketPrioritySchema.safeParse(priority).success ? (priority as TicketPriority) : undefined,
    slaState,
  });

  res.json({
    actor: { type: actorTypeResult.data, id: req.params.actorId },
    tickets,
    total: tickets.length,
  });
});

router.get("/:id/activity", async (req, res) => {
  const activity = await ticketStore.listActivity(req.params.id);
  if (!activity) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  res.json({ updates: activity, total: activity.length });
});

router.get("/:id", async (req, res) => {
  const aggregate = await ticketStore.get(req.params.id);
  if (!aggregate) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  res.json(aggregate);
});

router.patch("/:id", requireRunId, async (req: AuthenticatedRequest, res) => {
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

  const aggregate = await ticketStore.updateTicket({
    ticketId: req.params.id,
    actor,
    title: parsed.title,
    description: parsed.description,
    priority: parsed.priority,
    dueDate: parsed.dueDate,
    tags: parsed.tags,
    assignees: parsed.assignees,
  });

  if (!aggregate) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  res.json(aggregate);
});

router.post("/:id/updates", requireRunId, async (req: AuthenticatedRequest, res) => {
  const parsed = parseBody(createUpdateSchema, req, res);
  if (!parsed) {
    return;
  }

  const actor = resolveActor(req, parsed.actorType);
  if (!actor) {
    res.status(401).json({ error: "Authenticated actor required" });
    return;
  }

  const update = await ticketStore.addUpdate({
    ticketId: req.params.id,
    actor,
    type: parsed.type as TicketUpdateType,
    content: parsed.content,
    metadata: parsed.metadata,
  });

  if (!update) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  res.status(201).json({ update });
});

router.post("/:id/transitions", requireRunId, async (req: AuthenticatedRequest, res) => {
  const parsed = parseBody(transitionSchema, req, res);
  if (!parsed) {
    return;
  }

  const actor = resolveActor(req, parsed.actorType);
  if (!actor) {
    res.status(401).json({ error: "Authenticated actor required" });
    return;
  }

  const result = await ticketStore.transitionTicket({
    ticketId: req.params.id,
    actor,
    status: parsed.status,
    reason: parsed.reason,
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

  res.json(result.aggregate);
});

export default router;
