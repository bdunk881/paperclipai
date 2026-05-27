import { NextFunction, Response, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import {
  TicketActorType,
  TicketAssignee,
  TicketPriority,
  TicketRecord,
  TicketStatus,
  TicketUpdateType,
  ticketStore,
} from "./ticketStore";
import { ticketSlaStore } from "./ticketSlaStore";
import { ticketSyncService } from "../ticketSync/service";
import { observabilityStore } from "../observability/store";
import {
  buildAgentPromptJobIdForTicket,
  buildPayloadIdempotencyKeyForTicket,
  isJobIdAlreadyExists,
} from "../queue/bullMqJobId";
import { getAgentPromptQueue } from "../queue/queues";
import { getPostgresPool, isPostgresConfigured } from "../db/postgres";
import * as Sentry from "@sentry/node";
import { asyncHandler } from "../middleware/asyncHandler";
import { handleStreamSse } from "../engine/agentTrace/streamSseHandler";
import type { WorkspaceStreamEnvelope } from "../engine/agentTrace/streamPublisher";

const TICKET_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// HEL-177: agent execution is the worker's job exclusively. Routes only
// enqueue. The legacy inline `resolveExecuteAgentPrompt()` fallback was
// removed — silent in-process execution defeats the whole point of the
// durable BullMQ pipeline (P3). When Redis is unavailable the dispatch
// is now logged + Sentry-reported; the ticket persists, but no agent
// run fires. A CI grep guard (see `.github/workflows/ci.yml`) prevents
// any future route from re-importing `executeAgentPrompt` directly.

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
  metadata: z.record(z.string(), z.unknown()).optional(),
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
    extensionMetadata: z.record(z.string(), z.unknown()).optional(),
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
      notifyTargets: z.array(z.string().trim().min(1).max(200)).max(25).optional(),
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

const slaSettingsSchema = z.object({
  workspaceId: z.string().uuid(),
  policies: z.array(
    z.object({
      priority: ticketPrioritySchema,
      firstResponseMinutes: z.number().int().positive(),
      resolutionMinutes: z.number().int().positive(),
    })
  ).length(4),
  escalationRules: z.array(
    z.object({
      priority: ticketPrioritySchema,
      notifyTargets: z.array(z.string().trim().min(1).max(200)).max(25),
      autoBumpPriority: z.boolean(),
      autoReassign: z.boolean(),
      fallbackActor: z
        .object({
          type: actorTypeSchema,
          id: z.string().trim().min(1),
        })
        .optional(),
    })
  ).length(4),
});

const bulkPolicyPatchSchema = z.object({
  workspaceId: z.string().uuid(),
  policies: z.array(
    z.object({
      priority: ticketPrioritySchema,
      firstResponseMinutes: z.number().int().positive(),
      resolutionMinutes: z.number().int().positive(),
    })
  ),
  escalationRules: z.array(z.unknown()).optional(),
});

const evaluateSlaSchema = z.object({
  now: z.string().datetime().optional(),
});

const PRIORITY_ORDER: TicketPriority[] = ["urgent", "high", "medium", "low"];

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

/**
 * HEL-174: Enqueue agent NL execution when a ticket has an agent
 * assignee. Picks the primary agent assignee (or first agent
 * assignee if none is marked primary). No-ops when there's no
 * agent assignee, when Postgres isn't configured, or when the
 * agent ID isn't a UUID.
 *
 * triggerKind:
 *   - "assignment" — fired on ticket create
 *   - "assignment_update" — fired on follow-up comment
 *   - "manual" — fired by Run-agent CTA
 */
async function dispatchAgentPromptForTicket(input: {
  ticket: TicketRecord;
  userId: string;
  triggerKind: "assignment" | "assignment_update" | "manual";
  /**
   * Latest content to surface as the agent's prompt. On create this
   * is the ticket description; on follow-up update it's the latest
   * comment so the agent picks up the new instruction.
   */
  prompt: string;
  /** Comment/update id for assignment_update dedupe (HEL-193). */
  updateId?: string;
}): Promise<void> {
  if (!isPostgresConfigured()) {
    return;
  }
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const agentAssignee =
    input.ticket.assignees.find((a) => a.type === "agent" && a.role === "primary") ??
    input.ticket.assignees.find((a) => a.type === "agent");
  if (!agentAssignee || !UUID_RE.test(agentAssignee.id)) {
    return;
  }
  const queue = getAgentPromptQueue();
  const jobId = buildAgentPromptJobIdForTicket({
    ticketId: input.ticket.id,
    triggerKind: input.triggerKind,
    updateId: input.updateId,
    prompt: input.prompt,
  });
  const idempotencyKey = buildPayloadIdempotencyKeyForTicket({
    ticketId: input.ticket.id,
    triggerKind: input.triggerKind,
    updateId: input.updateId,
    prompt: input.prompt,
  });
  const payload = {
    workspaceId: input.ticket.workspaceId,
    userId: input.userId,
    agentId: agentAssignee.id,
    prompt: input.prompt,
    sourceTicketId: input.ticket.id,
    triggerKind: input.triggerKind,
    idempotencyKey,
  };
  if (!queue) {
    // HEL-177: no silent inline fallback. The agent run is dropped on
    // the floor, the ticket persists, and we log + Sentry-report so an
    // operator notices the queue is misconfigured. Better to surface
    // the configuration gap than to mask it with in-process execution
    // that won't survive an API restart.
    //
    // Codex P2: keep the Sentry message constant so all dispatches
    // during a queue outage group into ONE issue. Per-dispatch IDs go
    // in tags + contexts where they don't fragment alert grouping.
    console.warn(
      `[tickets] agent prompt queue unavailable — dispatch skipped for ticket=${payload.sourceTicketId} agent=${payload.agentId}`,
    );
    Sentry.captureMessage("agent_prompt_queue_unavailable", {
      level: "warning",
      tags: {
        component: "tickets",
        reason: "agent_prompt_queue_unavailable",
        triggerKind: payload.triggerKind,
      },
      contexts: {
        dispatch: {
          ticketId: payload.sourceTicketId,
          agentId: payload.agentId,
          workspaceId: payload.workspaceId,
          triggerKind: payload.triggerKind,
        },
      },
    });
    return;
  }
  try {
    await queue.add(input.triggerKind, payload, { jobId });
  } catch (err) {
    if (isJobIdAlreadyExists(err)) {
      return;
    }
    throw err;
  }
}

function targetToMinutes(target: { kind: "minutes" | "business_days"; value: number }): number {
  return target.kind === "business_days" ? target.value * 1440 : target.value;
}

function minutesToTarget(minutes: number): { kind: "minutes"; value: number } {
  return { kind: "minutes", value: minutes };
}

function collectFallbackCandidates(
  tickets: Array<{ assignees: Array<{ type: TicketActorType; id: string }> }>,
  policies: Array<{ escalation: { fallbackAssignee?: { type: TicketActorType; id: string } } }>,
) {
  const candidates = new Map<string, { type: TicketActorType; id: string }>();

  for (const ticket of tickets) {
    for (const assignee of ticket.assignees) {
      candidates.set(`${assignee.type}:${assignee.id}`, { type: assignee.type, id: assignee.id });
    }
  }

  for (const policy of policies) {
    const fallback = policy.escalation.fallbackAssignee;
    if (fallback) {
      candidates.set(`${fallback.type}:${fallback.id}`, { type: fallback.type, id: fallback.id });
    }
  }

  return Array.from(candidates.values()).sort(
    (left, right) => left.type.localeCompare(right.type) || left.id.localeCompare(right.id),
  );
}

async function buildSlaSettingsPayload(context: { workspaceId: string; userId: string }) {
  const [policies, tickets] = await Promise.all([
    ticketStore.listPolicies(context.workspaceId, context),
    ticketStore.list({ workspaceId: context.workspaceId }, context),
  ]);
  const fallbackCandidates = collectFallbackCandidates(tickets, policies);

  return {
    policies: PRIORITY_ORDER.map((priority) => {
      const policy = policies.find((candidate) => candidate.priority === priority);
      if (!policy) {
        throw new Error(`Missing SLA policy for priority ${priority}`);
      }
      return {
        priority,
        firstResponseMinutes: targetToMinutes(policy.firstResponseTarget),
        resolutionMinutes: targetToMinutes(policy.resolutionTarget),
      };
    }),
    escalationRules: PRIORITY_ORDER.map((priority) => {
      const policy = policies.find((candidate) => candidate.priority === priority);
      if (!policy) {
        throw new Error(`Missing SLA policy for priority ${priority}`);
      }
      return {
        priority,
        notifyTargets: [...(policy.escalation.notifyTargets ?? [])],
        autoBumpPriority: policy.escalation.autoBumpPriority,
        autoReassign: policy.escalation.autoReassign,
        fallbackActor: policy.escalation.fallbackAssignee
          ? { ...policy.escalation.fallbackAssignee }
          : undefined,
      };
    }),
    fallbackCandidates,
    updatedAt: policies.reduce(
      (latest, policy) => (policy.updatedAt > latest ? policy.updatedAt : latest),
      policies[0]?.updatedAt ?? new Date().toISOString(),
    ),
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

router.post("/", requireRunId, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
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

  observabilityStore.record({
    workspaceId: context.workspaceId,
    userId: actor.id,
    category: "issue",
    type: "issue.created",
    actor: { type: actor.type, id: actor.id, label: actor.id },
    subject: {
      type: "ticket",
      id: aggregate.ticket.id,
      label: aggregate.ticket.title,
      parentType: "workspace",
      parentId: aggregate.ticket.workspaceId,
    },
    summary: `Ticket created: ${aggregate.ticket.title}`,
    payload: {
      status: aggregate.ticket.status,
      metadata: {
        priority: aggregate.ticket.priority,
        tags: aggregate.ticket.tags,
      },
    },
    occurredAt: aggregate.ticket.createdAt,
  });

  // HEL-174: if the new assignment has an agent assignee, kick off the
  // agent NL execution. Mission Assignments are the front-door for
  // user → agent NL requests; this is the dispatch hook.
  await dispatchAgentPromptForTicket({
    ticket: aggregate.ticket,
    userId: actor.id,
    triggerKind: "assignment",
    prompt: aggregate.ticket.description || aggregate.ticket.title,
  }).catch((err) => {
    console.warn(
      `[tickets] HEL-174 dispatch failed for ticket=${aggregate.ticket.id}: ${(err as Error).message}`,
    );
  });

  res.status(201).json(aggregate);
}));

router.get("/", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
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
}));

router.get("/sla/policies", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  const context = resolveWorkspaceContext(req, res, workspaceId);
  if (!context) {
    return;
  }
  const policies = await ticketStore.listPolicies(context.workspaceId, context);
  res.json({ policies, total: policies.length });
}));

router.get("/sla/settings", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  const context = resolveWorkspaceContext(req, res, workspaceId);
  if (!context) {
    return;
  }

  res.json(await buildSlaSettingsPayload(context));
}));

router.get("/sla/dashboard", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  const context = resolveWorkspaceContext(req, res, workspaceId);
  if (!context) {
    return;
  }

  await ticketStore.evaluateSla({ workspaceId: context.workspaceId, context });

  const tickets = await ticketStore.list({ workspaceId: context.workspaceId }, context);
  const snapshots = await ticketSlaStore.listByWorkspace(context.workspaceId, context);
  const snapshotByTicketId = new Map(snapshots.map((snapshot) => [snapshot.ticketId, snapshot]));

  const activeTickets = tickets.filter((ticket) => ["open", "in_progress", "blocked"].includes(ticket.status));
  const resolvedTickets = tickets.filter((ticket) => Boolean(ticket.resolvedAt));
  const breachedTickets = activeTickets.filter((ticket) => ticket.slaState === "breached");
  const atRiskTickets = activeTickets.filter((ticket) => ticket.slaState === "at_risk");

  const firstResponseMinutes = snapshots
    .filter((snapshot) => snapshot.firstResponseRespondedAt)
    .map((snapshot) => {
      const ticket = tickets.find((candidate) => candidate.id === snapshot.ticketId);
      if (!ticket || !snapshot.firstResponseRespondedAt) {
        return null;
      }
      return (
        (new Date(snapshot.firstResponseRespondedAt).getTime() - new Date(ticket.createdAt).getTime()) /
        60_000
      );
    })
    .filter((value): value is number => value !== null && Number.isFinite(value));

  const avgFirstResponseMinutes =
    firstResponseMinutes.length > 0
      ? firstResponseMinutes.reduce((sum, value) => sum + value, 0) / firstResponseMinutes.length
      : 0;

  const resolutionDurationsHours = resolvedTickets
    .filter((ticket) => ticket.resolvedAt)
    .map((ticket) => (new Date(ticket.resolvedAt as string).getTime() - new Date(ticket.createdAt).getTime()) / 3_600_000)
    .filter((value) => Number.isFinite(value) && value >= 0);

  const resolutionBuckets = [
    { label: "<1h", test: (hours: number) => hours < 1, count: 0 },
    { label: "1-4h", test: (hours: number) => hours >= 1 && hours < 4, count: 0 },
    { label: "4-24h", test: (hours: number) => hours >= 4 && hours < 24, count: 0 },
    { label: "1-3d", test: (hours: number) => hours >= 24 && hours < 72, count: 0 },
    { label: "3d+", test: (hours: number) => hours >= 72, count: 0 },
  ];

  for (const hours of resolutionDurationsHours) {
    const bucket = resolutionBuckets.find((candidate) => candidate.test(hours));
    if (bucket) {
      bucket.count += 1;
    }
  }

  const actorRows = new Map<string, {
    actor: TicketAssignee;
    activeCount: number;
    atRiskCount: number;
    breachedCount: number;
    resolutionDurationsHours: number[];
  }>();

  for (const ticket of tickets) {
    const primaryAssignee = ticket.assignees.find((assignee) => assignee.role === "primary");
    if (!primaryAssignee) {
      continue;
    }

    const key = `${primaryAssignee.type}:${primaryAssignee.id}`;
    const row = actorRows.get(key) ?? {
      actor: primaryAssignee,
      activeCount: 0,
      atRiskCount: 0,
      breachedCount: 0,
      resolutionDurationsHours: [],
    };

    if (["open", "in_progress", "blocked"].includes(ticket.status)) {
      row.activeCount += 1;
    }
    if (ticket.slaState === "at_risk") {
      row.atRiskCount += 1;
    }
    if (ticket.slaState === "breached") {
      row.breachedCount += 1;
    }
    if (ticket.resolvedAt) {
      row.resolutionDurationsHours.push(
        (new Date(ticket.resolvedAt).getTime() - new Date(ticket.createdAt).getTime()) / 3_600_000
      );
    }

    actorRows.set(key, row);
  }

  const priorityBreakdown = (["urgent", "high", "medium", "low"] as TicketPriority[]).map((priority) => {
    const priorityTickets = tickets.filter((ticket) => ticket.priority === priority);
    const priorityActiveTickets = priorityTickets.filter((ticket) =>
      ["open", "in_progress", "blocked"].includes(ticket.status)
    );
    const respondedMinutes = priorityTickets
      .map((ticket) => {
        const snapshot = snapshotByTicketId.get(ticket.id);
        if (!snapshot?.firstResponseRespondedAt) {
          return null;
        }
        return (
          (new Date(snapshot.firstResponseRespondedAt).getTime() - new Date(ticket.createdAt).getTime()) /
          60_000
        );
      })
      .filter((value): value is number => value !== null && Number.isFinite(value));

    return {
      priority,
      activeCount: priorityActiveTickets.length,
      atRiskCount: priorityActiveTickets.filter((ticket) => ticket.slaState === "at_risk").length,
      breachRate:
        priorityActiveTickets.length > 0
          ? Math.round(
              (priorityActiveTickets.filter((ticket) => ticket.slaState === "breached").length /
                priorityActiveTickets.length) *
                100
            )
          : 0,
      avgFirstResponseMinutes:
        respondedMinutes.length > 0
          ? Math.round(respondedMinutes.reduce((sum, value) => sum + value, 0) / respondedMinutes.length)
          : 0,
    };
  });

  res.json({
    summaryCards: [
      {
        key: "breach_rate",
        label: "Breach Rate",
        value: `${activeTickets.length > 0 ? ((breachedTickets.length / activeTickets.length) * 100).toFixed(1) : "0.0"}%`,
        delta: `${breachedTickets.length} active`,
        trend: breachedTickets.length === 0 ? "improving" : "worsening",
      },
      {
        key: "avg_first_response",
        label: "Avg Time to First Response",
        value: avgFirstResponseMinutes >= 60
          ? `${(avgFirstResponseMinutes / 60).toFixed(1)}h`
          : `${Math.round(avgFirstResponseMinutes)}m`,
        delta: `${firstResponseMinutes.length} measured`,
        trend: avgFirstResponseMinutes <= 60 ? "improving" : "worsening",
      },
      {
        key: "active_breaches",
        label: "Active Breaches",
        value: String(breachedTickets.length),
        delta: `${atRiskTickets.length} at risk`,
        trend: breachedTickets.length === 0 ? "improving" : "worsening",
      },
    ],
    resolutionBuckets: resolutionBuckets.map((bucket) => ({
      label: bucket.label,
      count: bucket.count,
      percent: resolutionDurationsHours.length > 0 ? Math.round((bucket.count / resolutionDurationsHours.length) * 100) : 0,
    })),
    actorBreakdown: Array.from(actorRows.values())
      .map((row) => ({
        actor: {
          type: row.actor.type,
          id: row.actor.id,
        },
        activeCount: row.activeCount,
        atRiskCount: row.atRiskCount,
        breachedCount: row.breachedCount,
        avgResolutionHours:
          row.resolutionDurationsHours.length > 0
            ? Number(
                (
                  row.resolutionDurationsHours.reduce((sum, value) => sum + value, 0) /
                  row.resolutionDurationsHours.length
                ).toFixed(1)
              )
            : 0,
      }))
      .sort((left, right) => right.activeCount - left.activeCount || left.actor.id.localeCompare(right.actor.id)),
    priorityBreakdown,
  });
}));

router.put("/sla/policies/:priority", requireRunId, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
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
}));

router.patch("/sla/policies", requireRunId, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const parsed = parseBody(bulkPolicyPatchSchema, req, res);
  if (!parsed) {
    return;
  }
  const context = resolveWorkspaceContext(req, res, parsed.workspaceId);
  if (!context) {
    return;
  }

  for (const policyRow of parsed.policies) {
    await ticketStore.upsertPolicy({
      workspaceId: context.workspaceId,
      priority: policyRow.priority,
      firstResponseTarget: minutesToTarget(policyRow.firstResponseMinutes),
      resolutionTarget: minutesToTarget(policyRow.resolutionMinutes),
      context,
    });
  }

  res.json(await buildSlaSettingsPayload(context));
}));

router.patch("/sla/settings", requireRunId, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const parsed = parseBody(slaSettingsSchema, req, res);
  if (!parsed) {
    return;
  }
  const context = resolveWorkspaceContext(req, res, parsed.workspaceId);
  if (!context) {
    return;
  }

  const escalationByPriority = new Map(parsed.escalationRules.map((rule) => [rule.priority, rule]));

  for (const policyRow of parsed.policies) {
    const escalationRule = escalationByPriority.get(policyRow.priority);
    if (!escalationRule) {
      res.status(400).json({ error: `Missing escalation rule for priority ${policyRow.priority}` });
      return;
    }

    await ticketStore.upsertPolicy({
      workspaceId: context.workspaceId,
      priority: policyRow.priority,
      firstResponseTarget: minutesToTarget(policyRow.firstResponseMinutes),
      resolutionTarget: minutesToTarget(policyRow.resolutionMinutes),
      escalation: {
        notify: escalationRule.notifyTargets.length > 0,
        notifyTargets: escalationRule.notifyTargets,
        autoBumpPriority: escalationRule.autoBumpPriority,
        autoReassign: escalationRule.autoReassign,
        fallbackAssignee: escalationRule.fallbackActor,
      },
      context,
    });
  }

  res.json(await buildSlaSettingsPayload(context));
}));

router.post("/sla/evaluate", requireRunId, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
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
}));

router.get("/notifications", asyncHandler<AuthenticatedRequest>(async (req, res) => {
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
}));

router.get("/queue/:actorType/:actorId", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
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
}));

router.get("/:id/activity", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
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
}));

router.get("/:id/children", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
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
}));

router.get("/:id", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
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
}));

router.patch("/:id", requireRunId, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
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

  observabilityStore.record({
    workspaceId: context.workspaceId,
    userId: actor.id,
    category: "issue",
    type: "issue.updated",
    actor: { type: actor.type, id: actor.id, label: actor.id },
    subject: {
      type: "ticket",
      id: aggregate.ticket.id,
      label: aggregate.ticket.title,
      parentType: "workspace",
      parentId: aggregate.ticket.workspaceId,
    },
    summary: `Ticket updated: ${aggregate.ticket.title}`,
    payload: {
      status: aggregate.ticket.status,
      metadata: {
        priority: aggregate.ticket.priority,
        dueDate: aggregate.ticket.dueDate ?? null,
        tags: aggregate.ticket.tags,
      },
    },
    occurredAt: aggregate.ticket.updatedAt,
  });

  res.json(aggregate);
}));

router.post("/:id/updates", requireRunId, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
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

      observabilityStore.record({
        workspaceId: context.workspaceId,
        userId: actor.id,
        category: "issue",
        type: "issue.commented",
        actor: { type: actor.type, id: actor.id, label: actor.id },
        subject: {
          type: "ticket",
          id: aggregate.ticket.id,
          label: aggregate.ticket.title,
          parentType: "workspace",
          parentId: aggregate.ticket.workspaceId,
        },
        summary: `Comment added to ${aggregate.ticket.title}`,
        payload: {
          status: aggregate.ticket.status,
          metadata: {
            updateType: update.type,
            updateId: update.id,
          },
        },
        occurredAt: update.createdAt,
      });

      // HEL-174: when a user adds a comment to an assignment with an
      // agent assignee, re-fire the agent with the new comment as the
      // prompt. Skip when the actor is the agent itself (avoids
      // self-trigger loops).
      if (actor.type === "user" && aggregate.ticket.status !== "resolved" && aggregate.ticket.status !== "cancelled") {
        await dispatchAgentPromptForTicket({
          ticket: aggregate.ticket,
          userId: actor.id,
          triggerKind: "assignment_update",
          prompt: update.content,
          updateId: update.id,
        }).catch((err) => {
          console.warn(
            `[tickets] HEL-174 follow-up dispatch failed for ticket=${aggregate.ticket.id}: ${(err as Error).message}`,
          );
        });
      }
    }
  }

  res.status(201).json({ update });
}));

/**
 * HEL-174: manual "Run agent" CTA on a ticket. Re-fires the agent
 * against the current state of the ticket. The ticket's latest comment
 * (or its description when no comments) is the prompt.
 */
router.post("/:id/run-agent", requireRunId, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }
  const actor = resolveActor(req, "user");
  if (!actor) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }
  const aggregate = await ticketStore.get(req.params.id, context);
  if (!aggregate) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  // Use the latest user/system comment as the prompt; fall back to
  // the ticket description.
  const latestUserUpdate = [...aggregate.updates]
    .reverse()
    .find(
      (u) =>
        u.type === "comment" &&
        (u.actor.type === "user" || u.actor.id === "system"),
    );
  const prompt = latestUserUpdate?.content || aggregate.ticket.description || aggregate.ticket.title;
  await dispatchAgentPromptForTicket({
    ticket: aggregate.ticket,
    userId: actor.id,
    triggerKind: "manual",
    prompt,
  });
  res.status(202).json({ status: "queued", ticketId: aggregate.ticket.id });
}));

/**
 * HEL-175: cancel the in-flight agent run for this ticket.
 *
 * Finds the most recent `runs` row where `source_ticket_id = :id` and
 * `status = 'running'` and flips it to `'cancelling'`. The worker's
 * cooperative cancel checkpoint in `executeAgentPrompt` reads the
 * status and bails before the next external call.
 *
 * Returns:
 *   - 202 with the cancelled run row when one was found
 *   - 404 when no active run exists for this ticket (idempotent UX:
 *     dashboard's Cancel button can be clicked without checking first)
 */
router.delete("/:id/cancel-active-run", requireRunId, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }
  if (!isPostgresConfigured()) {
    res.status(503).json({ error: "Run cancellation requires PostgreSQL persistence." });
    return;
  }
  const pool = getPostgresPool();
  // Look up the active run for this ticket. Latest started_at wins so
  // re-clicks of Run-agent followed by Cancel target the freshest one.
  const activeResult = await pool.query<{ id: string }>(
    `SELECT id::text
       FROM runs
      WHERE source_ticket_id = $1::uuid
        AND status = 'running'
        AND workspace_id = $2::uuid
      ORDER BY started_at DESC
      LIMIT 1`,
    [req.params.id, context.workspaceId],
  );
  if (activeResult.rowCount === 0) {
    res.status(404).json({ error: "No active agent run found for this ticket" });
    return;
  }
  const runId = activeResult.rows[0]!.id;
  await pool.query(
    `UPDATE runs SET status = 'cancelling' WHERE id = $1::uuid AND status = 'running'`,
    [runId],
  );
  res.status(202).json({ status: "cancelling", runId, ticketId: req.params.id });
}));

router.post("/:id/transitions", requireRunId, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
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

    observabilityStore.record({
      workspaceId: context.workspaceId,
      userId: actor.id,
      category: "issue",
      type: "issue.status_changed",
      actor: { type: actor.type, id: actor.id, label: actor.id },
      subject: {
        type: "ticket",
        id: result.aggregate.ticket.id,
        label: result.aggregate.ticket.title,
        parentType: "workspace",
        parentId: result.aggregate.ticket.workspaceId,
      },
      summary: `Ticket moved to ${result.aggregate.ticket.status}`,
      payload: {
        status: result.aggregate.ticket.status,
        metadata: {
          reason: parsed.reason ?? null,
          relevantMemoryCount: result.relevantMemories?.length ?? 0,
        },
      },
      occurredAt: result.aggregate.ticket.updatedAt,
    });
  }

  res.json({
    ...result.aggregate,
    relevantMemories: result.relevantMemories ?? [],
    ...(result.closeContract ? { closeContract: result.closeContract } : {}),
  });
}));

// -------------------------------------------------------------------------
// GET /api/tickets/stream — workspace-wide firehose of ticket activity.
// Emits ticket.created, ticket.update.appended, and run.lifecycle /
// trace.forward events that carry a ticketId. List view subscribes for
// live status badges.
// -------------------------------------------------------------------------
router.get("/stream", asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
  if (!workspaceId) {
    res.status(401).json({ error: "Workspace required" });
    return;
  }
  await handleStreamSse(req, res, {
    workspaceId,
    filter: (envelope: WorkspaceStreamEnvelope) => {
      const { event } = envelope;
      switch (event.kind) {
        case "ticket.created":
        case "ticket.update.appended":
          return true;
        case "run.lifecycle":
        case "trace.forward":
          return Boolean(event.ticketId);
        default:
          return false;
      }
    },
  });
}));

// -------------------------------------------------------------------------
// GET /api/tickets/:id/stream — scoped to a single ticket. Emits update
// appends plus the lifecycle + forwarded trace events for runs whose
// sourceTicketId == :id. Detail view subscribes for live timeline.
// -------------------------------------------------------------------------
router.get("/:id/stream", asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
  const ticketId = req.params.id;
  if (!workspaceId) {
    res.status(401).json({ error: "Workspace required" });
    return;
  }
  if (!TICKET_UUID_RE.test(ticketId)) {
    res.status(400).json({ error: "Invalid ticket ID format" });
    return;
  }
  const aggregate = await ticketStore.get(ticketId, {
    workspaceId,
    userId: (req as AuthenticatedRequest).auth?.sub ?? "",
  });
  if (!aggregate || aggregate.ticket.workspaceId !== workspaceId) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  await handleStreamSse(req, res, {
    workspaceId,
    filter: (envelope: WorkspaceStreamEnvelope) => {
      const { event } = envelope;
      switch (event.kind) {
        case "ticket.created":
          return event.ticketId === ticketId;
        case "ticket.update.appended":
          return event.ticketId === ticketId;
        case "run.lifecycle":
        case "trace.forward":
          return event.ticketId === ticketId;
        default:
          return false;
      }
    },
  });
}));

export default router;
