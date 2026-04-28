import express, { NextFunction, Response, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import {
  AskCeoRequest,
  HitlCheckpointStatus,
  HitlCheckpointTriggerType,
  HitlCommentStatus,
  HitlRecipientType,
  hitlStore,
} from "./hitlStore";

const router = Router();

const notificationChannelSchema = z.enum(["inbox", "email", "agent_wake"]);
const recipientTypeSchema = z.enum(["agent", "user"]);
const checkpointTriggerTypeSchema = z.enum([
  "end_of_week_review",
  "milestone_gate",
  "kpi_deviation",
  "manual",
]);
const checkpointStatusSchema = z.enum(["pending", "acknowledged", "resolved", "dismissed"]);
const commentStatusSchema = z.enum(["open", "resolved"]);

const scheduleUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    timezone: z.string().trim().min(1).max(128).optional(),
    notificationChannels: z.array(notificationChannelSchema).min(1).optional(),
    weeklyReview: z
      .object({
        enabled: z.boolean().optional(),
        dayOfWeek: z.number().int().min(0).max(6).optional(),
        hour: z.number().int().min(0).max(23).optional(),
        minute: z.number().int().min(0).max(59).optional(),
      })
      .optional(),
    milestoneGate: z
      .object({
        enabled: z.boolean().optional(),
        blockingStatuses: z.array(z.string().trim().min(1).max(64)).min(1).optional(),
      })
      .optional(),
    kpiDeviation: z
      .object({
        enabled: z.boolean().optional(),
        thresholds: z
          .array(
            z.object({
              metricKey: z.string().trim().min(1).max(128),
              comparator: z.enum(["gt", "gte", "lt", "lte", "percent_drop"]),
              threshold: z.number(),
              window: z.enum(["hour", "day", "week"]),
            })
          )
          .optional(),
      })
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one checkpoint schedule field is required");

const manualCheckpointSchema = z.object({
  triggerType: checkpointTriggerTypeSchema.default("manual"),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  dueAt: z.string().datetime().optional(),
  artifactRefs: z.array(z.string().trim().min(1).max(512)).max(25).optional(),
  metadata: z.record(z.unknown()).optional(),
  recipientType: recipientTypeSchema,
  recipientId: z.string().trim().min(1).max(200),
});

const triggerEvaluationSchema = z.object({
  triggerType: z.enum(["end_of_week_review", "milestone_gate", "kpi_deviation"]),
  recipientType: recipientTypeSchema,
  recipientId: z.string().trim().min(1).max(200),
  event: z.record(z.unknown()),
});

const artifactCommentSchema = z.object({
  artifact: z.object({
    kind: z.enum(["ticket", "approval", "run", "document", "workflow_step", "other"]),
    id: z.string().trim().min(1).max(200),
    title: z.string().trim().max(200).optional(),
    path: z.string().trim().max(512).optional(),
    version: z.string().trim().max(128).optional(),
  }),
  anchor: z
    .object({
      quote: z.string().trim().min(1).max(500).optional(),
      lineStart: z.number().int().min(1).optional(),
      lineEnd: z.number().int().min(1).optional(),
      startOffset: z.number().int().min(0).optional(),
      endOffset: z.number().int().min(0).optional(),
      fieldKey: z.string().trim().max(128).optional(),
    })
    .optional(),
  body: z.string().trim().min(1).max(5000),
  routing: z.object({
    recipientType: recipientTypeSchema,
    recipientId: z.string().trim().min(1).max(200),
    responsibleAgentId: z.string().trim().min(1).max(200).optional(),
    reason: z.string().trim().max(500).optional(),
  }),
});

const askCeoRequestSchema = z.object({
  question: z.string().trim().min(1).max(5000),
  context: z
    .object({
      artifactRef: z.string().trim().min(1).max(512).optional(),
      taskId: z.string().trim().min(1).max(200).optional(),
      checkpointId: z.string().trim().min(1).max(200).optional(),
    })
    .optional(),
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

function requirePaperclipRunId(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const runId = req.header("X-Paperclip-Run-Id");
  if (!runId?.trim()) {
    res.status(400).json({ error: "X-Paperclip-Run-Id header is required for mutating HITL requests" });
    return;
  }
  next();
}

function getUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function requireUserId(req: AuthenticatedRequest, res: Response): string | null {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return null;
  }
  return userId;
}

function readCompanyId(req: AuthenticatedRequest, res: Response): string | null {
  const companyId = typeof req.params.companyId === "string" ? req.params.companyId.trim() : "";
  if (!companyId) {
    res.status(400).json({ error: "companyId is required" });
    return null;
  }
  return companyId;
}

router.get("/companies/:companyId/checkpoint-schedule", (req: AuthenticatedRequest, res) => {
  const userId = requireUserId(req, res);
  const companyId = readCompanyId(req, res);
  if (!userId || !companyId) {
    return;
  }
  res.json({ schedule: hitlStore.getSchedule(userId, companyId) });
});

router.put(
  "/companies/:companyId/checkpoint-schedule",
  requirePaperclipRunId,
  (req: AuthenticatedRequest, res) => {
    const userId = requireUserId(req, res);
    const companyId = readCompanyId(req, res);
    if (!userId || !companyId) {
      return;
    }
    const parsed = parseBody(scheduleUpdateSchema, req, res);
    if (!parsed) {
      return;
    }
    res.json({ schedule: hitlStore.upsertSchedule(userId, companyId, parsed) });
  }
);

router.get("/companies/:companyId/checkpoints", (req: AuthenticatedRequest, res) => {
  const userId = requireUserId(req, res);
  const companyId = readCompanyId(req, res);
  if (!userId || !companyId) {
    return;
  }
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  res.json({
    checkpoints: hitlStore.listCheckpoints(
      userId,
      companyId,
      checkpointStatusSchema.safeParse(status).success ? (status as HitlCheckpointStatus) : undefined
    ),
  });
});

router.post("/companies/:companyId/checkpoints", requirePaperclipRunId, (req: AuthenticatedRequest, res) => {
  const userId = requireUserId(req, res);
  const companyId = readCompanyId(req, res);
  if (!userId || !companyId) {
    return;
  }
  const parsed = parseBody(manualCheckpointSchema, req, res);
  if (!parsed) {
    return;
  }
  const checkpoint = hitlStore.createCheckpoint({
    userId,
    companyId,
    triggerType: parsed.triggerType as HitlCheckpointTriggerType,
    source: parsed.triggerType === "manual" ? "manual" : "system",
    title: parsed.title,
    description: parsed.description,
    dueAt: parsed.dueAt,
    artifactRefs: parsed.artifactRefs,
    metadata: parsed.metadata,
    recipientType: parsed.recipientType as HitlRecipientType,
    recipientId: parsed.recipientId,
  });
  res.status(201).json({ checkpoint });
});

router.post(
  "/companies/:companyId/checkpoints/evaluate-trigger",
  requirePaperclipRunId,
  (req: AuthenticatedRequest, res) => {
    const userId = requireUserId(req, res);
    const companyId = readCompanyId(req, res);
    if (!userId || !companyId) {
      return;
    }
    const parsed = parseBody(triggerEvaluationSchema, req, res);
    if (!parsed) {
      return;
    }
    const evaluation = hitlStore.evaluateDefaultTrigger({
      userId,
      companyId,
      triggerType: parsed.triggerType,
      recipientType: parsed.recipientType as HitlRecipientType,
      recipientId: parsed.recipientId,
      event: parsed.event,
    });
    res.json(evaluation);
  }
);

router.get("/companies/:companyId/artifact-comments", (req: AuthenticatedRequest, res) => {
  const userId = requireUserId(req, res);
  const companyId = readCompanyId(req, res);
  if (!userId || !companyId) {
    return;
  }
  const artifactId = typeof req.query.artifactId === "string" ? req.query.artifactId : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const comments = hitlStore
    .listArtifactComments(userId, companyId, artifactId)
    .filter((comment) =>
      commentStatusSchema.safeParse(status).success ? comment.status === (status as HitlCommentStatus) : true
    );
  res.json({ comments, total: comments.length });
});

router.post(
  "/companies/:companyId/artifact-comments",
  requirePaperclipRunId,
  (req: AuthenticatedRequest, res) => {
    const userId = requireUserId(req, res);
    const companyId = readCompanyId(req, res);
    if (!userId || !companyId) {
      return;
    }
    const parsed = parseBody(artifactCommentSchema, req, res);
    if (!parsed) {
      return;
    }
    const comment = hitlStore.createArtifactComment({
      userId,
      companyId,
      artifact: parsed.artifact,
      anchor: parsed.anchor,
      body: parsed.body,
      routing: parsed.routing,
    });
    res.status(201).json({ comment });
  }
);

router.post("/companies/:companyId/ask-ceo/requests", requirePaperclipRunId, (req: AuthenticatedRequest, res) => {
  const userId = requireUserId(req, res);
  const companyId = readCompanyId(req, res);
  if (!userId || !companyId) {
    return;
  }
  const parsed = parseBody(askCeoRequestSchema, req, res);
  if (!parsed) {
    return;
  }
  const requestRecord = hitlStore.createAskCeoRequest({
    userId,
    companyId,
    question: parsed.question,
    context: parsed.context as AskCeoRequest["context"] | undefined,
  });
  res.status(201).json({ request: requestRecord });
});

router.get("/companies/:companyId/ask-ceo/requests/:requestId", (req: AuthenticatedRequest, res) => {
  const userId = requireUserId(req, res);
  const companyId = readCompanyId(req, res);
  if (!userId || !companyId) {
    return;
  }
  const requestRecord = hitlStore.getAskCeoRequest(userId, companyId, req.params.requestId);
  if (!requestRecord) {
    res.status(404).json({ error: "Ask the CEO request not found" });
    return;
  }
  res.json({ request: requestRecord });
});

router.get("/companies/:companyId/state", (req: AuthenticatedRequest, res) => {
  const userId = requireUserId(req, res);
  const companyId = readCompanyId(req, res);
  if (!userId || !companyId) {
    return;
  }
  res.json(hitlStore.getCompanyState(userId, companyId));
});

router.get("/companies/:companyId/notifications", (req: AuthenticatedRequest, res) => {
  const userId = requireUserId(req, res);
  const companyId = readCompanyId(req, res);
  if (!userId || !companyId) {
    return;
  }
  const recipientType = typeof req.query.recipientType === "string" ? req.query.recipientType : undefined;
  const recipientId = typeof req.query.recipientId === "string" ? req.query.recipientId : undefined;
  const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
  const notifications = hitlStore.listNotifications({
    userId,
    companyId,
    recipientType: recipientTypeSchema.safeParse(recipientType).success
      ? (recipientType as HitlRecipientType)
      : undefined,
    recipientId,
    kind:
      kind === "checkpoint" || kind === "artifact_comment" || kind === "ask_ceo_response"
        ? kind
        : undefined,
  });
  res.json({ notifications, total: notifications.length });
});

export default router;
