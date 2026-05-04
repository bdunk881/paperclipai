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
import { ticketSlaStore } from "./ticketSlaStore";
import { ticketSyncService } from "../ticketSync/service";
import { observabilityStore } from "../observability/store";

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

  observabilityStore.record({
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

router.get("/sla/settings", async (req: WorkspaceAwareRequest, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  const context = resolveWorkspaceContext(req, res, workspaceId);
  if (!context) {
    return;
  }

  res.json(await buildSlaSettingsPayload(context));
});

router.get("/sla/dashboard", async (req: WorkspaceAwareRequest, res) => {
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

router.patch("/sla/policies", requireRunId, async (req: WorkspaceAwareRequest, res) => {
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
});

router.patch("/sla/settings", requireRunId, async (req: WorkspaceAwareRequest, res) => {
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

  observabilityStore.record({
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

      observabilityStore.record({
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

    observabilityStore.record({
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
});

export default router;
