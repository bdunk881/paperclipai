/**
 * HITL (human-in-the-loop) store.
 *
 * DASH-45: was previously five top-level `Map<>` structures (schedules,
 * checkpoints, artifactComments, askCeoRequests, notifications). Every
 * Fly restart wiped them, so checkpoints/comments/ask-CEO escalations
 * were session-bound and silently lost across deploys.
 *
 * All methods are now async + Postgres-aware. The in-memory branch only
 * fires when `inMemoryAllowed()` is true (tests, dev without DATABASE_URL);
 * HEL-80's double-lock keeps production safe from accidental memory mode.
 *
 * The five canonical tables (migration 041) mirror the in-memory shape
 * 1:1 so this rewrite stayed mechanical — no semantic changes to any
 * route handler beyond `async` + `await`.
 */

import { randomUUID } from "crypto";
import { controlPlaneStore } from "../controlPlane/controlPlaneStore";
import { parseJsonValue, serializeJson } from "../db/json";
import { getPostgresPool, inMemoryAllowed, isPostgresPersistenceEnabled } from "../db/postgres";

export type HitlNotificationChannel = "inbox" | "email" | "agent_wake";
export type HitlNotificationStatus = "pending" | "sent" | "failed";
export type HitlRecipientType = "agent" | "user";
export type HitlCheckpointTriggerType =
  | "end_of_week_review"
  | "milestone_gate"
  | "kpi_deviation"
  | "manual";
export type HitlCheckpointStatus = "pending" | "acknowledged" | "resolved" | "dismissed";
export type HitlCommentStatus = "open" | "resolved";

export interface HitlKpiThreshold {
  metricKey: string;
  comparator: "gt" | "gte" | "lt" | "lte" | "percent_drop";
  threshold: number;
  window: "hour" | "day" | "week";
}

export interface HitlCheckpointSchedule {
  id: string;
  companyId: string;
  userId: string;
  enabled: boolean;
  timezone: string;
  notificationChannels: HitlNotificationChannel[];
  weeklyReview: {
    enabled: boolean;
    dayOfWeek: number;
    hour: number;
    minute: number;
  };
  milestoneGate: {
    enabled: boolean;
    blockingStatuses: string[];
  };
  kpiDeviation: {
    enabled: boolean;
    thresholds: HitlKpiThreshold[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface HitlNotification {
  id: string;
  companyId: string;
  userId: string;
  kind: "checkpoint" | "artifact_comment" | "ask_ceo_response";
  channel: HitlNotificationChannel;
  recipientType: HitlRecipientType;
  recipientId: string;
  status: HitlNotificationStatus;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface HitlCheckpoint {
  id: string;
  companyId: string;
  userId: string;
  triggerType: HitlCheckpointTriggerType;
  source: "system" | "manual";
  title: string;
  description?: string;
  status: HitlCheckpointStatus;
  dueAt?: string;
  artifactRefs: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  notificationIds: string[];
}

export interface HitlArtifactRef {
  kind: "ticket" | "approval" | "run" | "document" | "workflow_step" | "other";
  id: string;
  title?: string;
  path?: string;
  version?: string;
}

export interface HitlArtifactAnchor {
  quote?: string;
  lineStart?: number;
  lineEnd?: number;
  startOffset?: number;
  endOffset?: number;
  fieldKey?: string;
}

export interface HitlArtifactComment {
  id: string;
  companyId: string;
  userId: string;
  artifact: HitlArtifactRef;
  anchor?: HitlArtifactAnchor;
  body: string;
  status: HitlCommentStatus;
  routing: {
    recipientType: HitlRecipientType;
    recipientId: string;
    responsibleAgentId?: string;
    reason?: string;
  };
  createdAt: string;
  updatedAt: string;
  notificationIds: string[];
}

export interface AskCeoRequest {
  id: string;
  companyId: string;
  userId: string;
  question: string;
  context?: {
    artifactRef?: string;
    taskId?: string;
    checkpointId?: string;
  };
  status: "answered";
  response: {
    summary: string;
    recommendedActions: string[];
    citedEntities: Array<{
      type: "team" | "task" | "checkpoint" | "artifact_comment";
      id: string;
      label: string;
    }>;
    companyStateVersion: string;
  };
  createdAt: string;
}

export interface HitlCheckpointScheduleUpdate {
  enabled?: boolean;
  timezone?: string;
  notificationChannels?: HitlNotificationChannel[];
  weeklyReview?: Partial<HitlCheckpointSchedule["weeklyReview"]>;
  milestoneGate?: Partial<HitlCheckpointSchedule["milestoneGate"]>;
  kpiDeviation?: {
    enabled?: boolean;
    thresholds?: HitlKpiThreshold[];
  };
}

interface CompanyStateSummary {
  companyId: string;
  version: string;
  team: {
    id: string;
    name: string;
    status: string;
    budgetMonthlyUsd: number;
    agentCount: number;
    activeExecutionCount: number;
    openTaskCount: number;
  } | null;
  hitl: {
    openCheckpointCount: number;
    unresolvedCommentCount: number;
    askCeoRequestCount: number;
  };
}

// ---------------------------------------------------------------------------
// In-memory mirrors (used only when Postgres is unavailable)
// ---------------------------------------------------------------------------

const schedules = new Map<string, HitlCheckpointSchedule>();
const checkpoints = new Map<string, HitlCheckpoint>();
const artifactComments = new Map<string, HitlArtifactComment>();
const askCeoRequests = new Map<string, AskCeoRequest>();
const notifications = new Map<string, HitlNotification>();

function nowIso(): string {
  return new Date().toISOString();
}

function scheduleKey(userId: string, companyId: string): string {
  return `${userId}:${companyId}`;
}

function postgresAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error("hitlStore requires DATABASE_URL outside development/test.");
}

function isoOrUndefined(v: Date | string | null | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  return v instanceof Date ? v.toISOString() : v;
}

function defaultSchedule(userId: string, companyId: string): HitlCheckpointSchedule {
  const timestamp = nowIso();
  return {
    id: randomUUID(),
    companyId,
    userId,
    enabled: true,
    timezone: "UTC",
    notificationChannels: ["inbox", "agent_wake"],
    weeklyReview: { enabled: true, dayOfWeek: 5, hour: 16, minute: 0 },
    milestoneGate: {
      enabled: true,
      blockingStatuses: ["at_risk", "ready_for_review", "blocked"],
    },
    kpiDeviation: { enabled: true, thresholds: [] },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

// ---------------------------------------------------------------------------
// Postgres mappers
// ---------------------------------------------------------------------------

interface ScheduleRow {
  id: string;
  user_id: string;
  company_id: string;
  enabled: boolean;
  timezone: string;
  notification_channels: HitlNotificationChannel[] | string;
  weekly_review_json: HitlCheckpointSchedule["weeklyReview"] | string;
  milestone_gate_json: HitlCheckpointSchedule["milestoneGate"] | string;
  kpi_deviation_json: HitlCheckpointSchedule["kpiDeviation"] | string;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapScheduleRow(row: ScheduleRow): HitlCheckpointSchedule {
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    enabled: row.enabled,
    timezone: row.timezone,
    notificationChannels: parseJsonValue<HitlNotificationChannel[]>(row.notification_channels, []),
    weeklyReview: parseJsonValue<HitlCheckpointSchedule["weeklyReview"]>(row.weekly_review_json, {
      enabled: false,
      dayOfWeek: 5,
      hour: 16,
      minute: 0,
    }),
    milestoneGate: parseJsonValue<HitlCheckpointSchedule["milestoneGate"]>(row.milestone_gate_json, {
      enabled: false,
      blockingStatuses: [],
    }),
    kpiDeviation: parseJsonValue<HitlCheckpointSchedule["kpiDeviation"]>(row.kpi_deviation_json, {
      enabled: false,
      thresholds: [],
    }),
    createdAt: isoOrUndefined(row.created_at) ?? nowIso(),
    updatedAt: isoOrUndefined(row.updated_at) ?? nowIso(),
  };
}

interface CheckpointRow {
  id: string;
  user_id: string;
  company_id: string;
  trigger_type: HitlCheckpointTriggerType;
  source: "system" | "manual";
  title: string;
  description: string | null;
  status: HitlCheckpointStatus;
  due_at: Date | string | null;
  artifact_refs: string[] | string;
  metadata: Record<string, unknown> | string | null;
  notification_ids: string[] | string;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapCheckpointRow(row: CheckpointRow): HitlCheckpoint {
  const metadata = row.metadata === null ? undefined : parseJsonValue<Record<string, unknown>>(row.metadata, {});
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    triggerType: row.trigger_type,
    source: row.source,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    dueAt: isoOrUndefined(row.due_at),
    artifactRefs: parseJsonValue<string[]>(row.artifact_refs, []),
    metadata,
    notificationIds: parseJsonValue<string[]>(row.notification_ids, []),
    createdAt: isoOrUndefined(row.created_at) ?? nowIso(),
    updatedAt: isoOrUndefined(row.updated_at) ?? nowIso(),
  };
}

interface CommentRow {
  id: string;
  user_id: string;
  company_id: string;
  artifact_kind: HitlArtifactRef["kind"];
  artifact_id: string;
  artifact_title: string | null;
  artifact_path: string | null;
  artifact_version: string | null;
  anchor_json: HitlArtifactAnchor | string | null;
  body: string;
  status: HitlCommentStatus;
  routing_json: HitlArtifactComment["routing"] | string;
  notification_ids: string[] | string;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapCommentRow(row: CommentRow): HitlArtifactComment {
  const anchor =
    row.anchor_json === null ? undefined : parseJsonValue<HitlArtifactAnchor>(row.anchor_json, {});
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    artifact: {
      kind: row.artifact_kind,
      id: row.artifact_id,
      title: row.artifact_title ?? undefined,
      path: row.artifact_path ?? undefined,
      version: row.artifact_version ?? undefined,
    },
    anchor,
    body: row.body,
    status: row.status,
    routing: parseJsonValue<HitlArtifactComment["routing"]>(row.routing_json, {
      recipientType: "user",
      recipientId: "",
    }),
    notificationIds: parseJsonValue<string[]>(row.notification_ids, []),
    createdAt: isoOrUndefined(row.created_at) ?? nowIso(),
    updatedAt: isoOrUndefined(row.updated_at) ?? nowIso(),
  };
}

interface AskCeoRow {
  id: string;
  user_id: string;
  company_id: string;
  question: string;
  context_json: AskCeoRequest["context"] | string | null;
  status: "answered";
  response_json: AskCeoRequest["response"] | string;
  created_at: Date | string;
}

function mapAskCeoRow(row: AskCeoRow): AskCeoRequest {
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    question: row.question,
    context: row.context_json === null ? undefined : parseJsonValue<AskCeoRequest["context"]>(row.context_json, {}),
    status: row.status,
    response: parseJsonValue<AskCeoRequest["response"]>(row.response_json, {
      summary: "",
      recommendedActions: [],
      citedEntities: [],
      companyStateVersion: "",
    }),
    createdAt: isoOrUndefined(row.created_at) ?? nowIso(),
  };
}

interface NotificationRow {
  id: string;
  user_id: string;
  company_id: string;
  kind: HitlNotification["kind"];
  channel: HitlNotificationChannel;
  recipient_type: HitlRecipientType;
  recipient_id: string;
  status: HitlNotificationStatus;
  payload: Record<string, unknown> | string;
  created_at: Date | string;
}

function mapNotificationRow(row: NotificationRow): HitlNotification {
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    kind: row.kind,
    channel: row.channel,
    recipientType: row.recipient_type,
    recipientId: row.recipient_id,
    status: row.status,
    payload: parseJsonValue<Record<string, unknown>>(row.payload, {}),
    createdAt: isoOrUndefined(row.created_at) ?? nowIso(),
  };
}

// ---------------------------------------------------------------------------
// Notification helper — emits one row per channel; persists alongside parent
// ---------------------------------------------------------------------------

async function createNotificationRecords(input: {
  companyId: string;
  userId: string;
  kind: HitlNotification["kind"];
  recipientType: HitlRecipientType;
  recipientId: string;
  channels: HitlNotificationChannel[];
  payload: Record<string, unknown>;
}): Promise<HitlNotification[]> {
  const createdAt = nowIso();
  const records: HitlNotification[] = input.channels.map((channel) => ({
    id: randomUUID(),
    companyId: input.companyId,
    userId: input.userId,
    kind: input.kind,
    channel,
    recipientType: input.recipientType,
    recipientId: input.recipientId,
    status: "pending",
    payload: input.payload,
    createdAt,
  }));

  if (!postgresAvailable()) {
    for (const notification of records) {
      notifications.set(notification.id, notification);
    }
    return records;
  }

  const pool = getPostgresPool();
  for (const n of records) {
    await pool.query(
      `INSERT INTO hitl_notifications (
         id, user_id, company_id, kind, channel, recipient_type, recipient_id,
         status, payload, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [
        n.id,
        n.userId,
        n.companyId,
        n.kind,
        n.channel,
        n.recipientType,
        n.recipientId,
        n.status,
        serializeJson(n.payload),
        n.createdAt,
      ],
    );
  }
  return records;
}

function compareThreshold(
  comparator: HitlKpiThreshold["comparator"],
  observedValue: number,
  threshold: number,
): boolean {
  switch (comparator) {
    case "gt":
      return observedValue > threshold;
    case "gte":
      return observedValue >= threshold;
    case "lt":
      return observedValue < threshold;
    case "lte":
      return observedValue <= threshold;
    case "percent_drop":
      return observedValue <= threshold;
  }
}

async function buildCompanyStateSummary(
  userId: string,
  companyId: string,
): Promise<CompanyStateSummary> {
  const team = controlPlaneStore.getTeam(companyId, userId);
  const teamAgents = team ? controlPlaneStore.listAgents(team.id, userId) : [];
  const teamExecutions = team ? controlPlaneStore.listExecutions(userId, team.id) : [];
  const teamTasks = team ? controlPlaneStore.listTasks(userId, team.id) : [];
  const companyCheckpoints = await hitlStore.listCheckpoints(userId, companyId);
  const companyComments = await hitlStore.listArtifactComments(userId, companyId);
  const companyAskCeo = await hitlStore.listAskCeoRequests(userId, companyId);

  return {
    companyId,
    version: nowIso(),
    team: team
      ? {
          id: team.id,
          name: team.name,
          status: team.status,
          budgetMonthlyUsd: team.budgetMonthlyUsd,
          agentCount: teamAgents.length,
          activeExecutionCount: teamExecutions.filter((execution) => execution.status === "running")
            .length,
          openTaskCount: teamTasks.filter((task) =>
            ["todo", "in_progress", "blocked"].includes(task.status),
          ).length,
        }
      : null,
    hitl: {
      openCheckpointCount: companyCheckpoints.filter((c) => ["pending", "acknowledged"].includes(c.status))
        .length,
      unresolvedCommentCount: companyComments.filter((c) => c.status === "open").length,
      askCeoRequestCount: companyAskCeo.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Public store
// ---------------------------------------------------------------------------

export const hitlStore = {
  async getSchedule(userId: string, companyId: string): Promise<HitlCheckpointSchedule> {
    if (!postgresAvailable()) {
      const key = scheduleKey(userId, companyId);
      const existing = schedules.get(key);
      if (existing) return existing;
      const created = defaultSchedule(userId, companyId);
      schedules.set(key, created);
      return created;
    }

    const pool = getPostgresPool();
    const result = await pool.query<ScheduleRow>(
      `SELECT * FROM hitl_schedules WHERE user_id = $1 AND company_id = $2 LIMIT 1`,
      [userId, companyId],
    );
    if (result.rowCount && result.rowCount > 0) {
      return mapScheduleRow(result.rows[0]);
    }
    const created = defaultSchedule(userId, companyId);
    await pool.query(
      `INSERT INTO hitl_schedules (
         id, user_id, company_id, enabled, timezone,
         notification_channels, weekly_review_json, milestone_gate_json,
         kpi_deviation_json, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11)`,
      [
        created.id,
        created.userId,
        created.companyId,
        created.enabled,
        created.timezone,
        serializeJson(created.notificationChannels),
        serializeJson(created.weeklyReview),
        serializeJson(created.milestoneGate),
        serializeJson(created.kpiDeviation),
        created.createdAt,
        created.updatedAt,
      ],
    );
    return created;
  },

  async upsertSchedule(
    userId: string,
    companyId: string,
    input: HitlCheckpointScheduleUpdate,
  ): Promise<HitlCheckpointSchedule> {
    const current = await this.getSchedule(userId, companyId);
    const updated: HitlCheckpointSchedule = {
      ...current,
      ...input,
      weeklyReview: { ...current.weeklyReview, ...input.weeklyReview },
      milestoneGate: { ...current.milestoneGate, ...input.milestoneGate },
      kpiDeviation: {
        ...current.kpiDeviation,
        ...input.kpiDeviation,
        thresholds: input.kpiDeviation?.thresholds ?? current.kpiDeviation.thresholds,
      },
      notificationChannels: input.notificationChannels ?? current.notificationChannels,
      updatedAt: nowIso(),
    };

    if (!postgresAvailable()) {
      schedules.set(scheduleKey(userId, companyId), updated);
      return updated;
    }

    const pool = getPostgresPool();
    await pool.query(
      `UPDATE hitl_schedules
          SET enabled = $1,
              timezone = $2,
              notification_channels = $3::jsonb,
              weekly_review_json = $4::jsonb,
              milestone_gate_json = $5::jsonb,
              kpi_deviation_json = $6::jsonb,
              updated_at = $7
        WHERE user_id = $8 AND company_id = $9`,
      [
        updated.enabled,
        updated.timezone,
        serializeJson(updated.notificationChannels),
        serializeJson(updated.weeklyReview),
        serializeJson(updated.milestoneGate),
        serializeJson(updated.kpiDeviation),
        updated.updatedAt,
        userId,
        companyId,
      ],
    );
    return updated;
  },

  async listCheckpoints(
    userId: string,
    companyId: string,
    status?: HitlCheckpointStatus,
  ): Promise<HitlCheckpoint[]> {
    if (!postgresAvailable()) {
      return Array.from(checkpoints.values())
        .filter((c) => c.userId === userId && c.companyId === companyId)
        .filter((c) => (status ? c.status === status : true))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    const pool = getPostgresPool();
    const params: unknown[] = [userId, companyId];
    let where = `user_id = $1 AND company_id = $2`;
    if (status) {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }
    const result = await pool.query<CheckpointRow>(
      `SELECT * FROM hitl_checkpoints WHERE ${where} ORDER BY created_at DESC`,
      params,
    );
    return result.rows.map(mapCheckpointRow);
  },

  async createCheckpoint(input: {
    userId: string;
    companyId: string;
    triggerType: HitlCheckpointTriggerType;
    source: "system" | "manual";
    title: string;
    description?: string;
    dueAt?: string;
    artifactRefs?: string[];
    metadata?: Record<string, unknown>;
    recipientType: HitlRecipientType;
    recipientId: string;
  }): Promise<HitlCheckpoint> {
    const timestamp = nowIso();
    const schedule = await this.getSchedule(input.userId, input.companyId);
    const notificationRecords = await createNotificationRecords({
      companyId: input.companyId,
      userId: input.userId,
      kind: "checkpoint",
      recipientType: input.recipientType,
      recipientId: input.recipientId,
      channels: schedule.notificationChannels,
      payload: { triggerType: input.triggerType, title: input.title, dueAt: input.dueAt },
    });
    const checkpoint: HitlCheckpoint = {
      id: randomUUID(),
      companyId: input.companyId,
      userId: input.userId,
      triggerType: input.triggerType,
      source: input.source,
      title: input.title,
      description: input.description,
      status: "pending",
      dueAt: input.dueAt,
      artifactRefs: input.artifactRefs ?? [],
      metadata: input.metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
      notificationIds: notificationRecords.map((n) => n.id),
    };

    if (!postgresAvailable()) {
      checkpoints.set(checkpoint.id, checkpoint);
      return checkpoint;
    }

    const pool = getPostgresPool();
    await pool.query(
      `INSERT INTO hitl_checkpoints (
         id, user_id, company_id, trigger_type, source, title, description,
         status, due_at, artifact_refs, metadata, notification_ids,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14)`,
      [
        checkpoint.id,
        checkpoint.userId,
        checkpoint.companyId,
        checkpoint.triggerType,
        checkpoint.source,
        checkpoint.title,
        checkpoint.description ?? null,
        checkpoint.status,
        checkpoint.dueAt ?? null,
        serializeJson(checkpoint.artifactRefs),
        checkpoint.metadata ? serializeJson(checkpoint.metadata) : null,
        serializeJson(checkpoint.notificationIds),
        checkpoint.createdAt,
        checkpoint.updatedAt,
      ],
    );
    return checkpoint;
  },

  async evaluateDefaultTrigger(input: {
    userId: string;
    companyId: string;
    recipientType: HitlRecipientType;
    recipientId: string;
    triggerType: Exclude<HitlCheckpointTriggerType, "manual">;
    event: Record<string, unknown>;
  }): Promise<{ matched: boolean; reason: string; checkpoint?: HitlCheckpoint }> {
    const schedule = await this.getSchedule(input.userId, input.companyId);
    if (!schedule.enabled) {
      return { matched: false, reason: "company checkpoint schedule is disabled" };
    }

    if (input.triggerType === "end_of_week_review") {
      if (!schedule.weeklyReview.enabled) {
        return { matched: false, reason: "weekly review trigger is disabled" };
      }
      const evaluatedAt =
        typeof input.event["evaluatedAt"] === "string"
          ? new Date(input.event["evaluatedAt"])
          : new Date();
      if (Number.isNaN(evaluatedAt.getTime())) {
        return { matched: false, reason: "evaluatedAt must be an ISO timestamp when provided" };
      }
      if (evaluatedAt.getUTCDay() !== schedule.weeklyReview.dayOfWeek) {
        return {
          matched: false,
          reason: "current day does not match the configured weekly review window",
        };
      }
      const checkpoint = await this.createCheckpoint({
        userId: input.userId,
        companyId: input.companyId,
        triggerType: input.triggerType,
        source: "system",
        title: "Weekly human review checkpoint",
        description: "Review active work, pending approvals, and company KPIs before the week closes.",
        recipientType: input.recipientType,
        recipientId: input.recipientId,
        metadata: input.event,
      });
      return { matched: true, reason: "weekly review window matched the configured day", checkpoint };
    }

    if (input.triggerType === "milestone_gate") {
      if (!schedule.milestoneGate.enabled) {
        return { matched: false, reason: "milestone gate trigger is disabled" };
      }
      const status = typeof input.event["status"] === "string" ? input.event["status"] : "";
      if (!schedule.milestoneGate.blockingStatuses.includes(status)) {
        return {
          matched: false,
          reason: "milestone status is not configured to open a checkpoint",
        };
      }
      const milestoneLabel =
        typeof input.event["label"] === "string" && input.event["label"].trim()
          ? input.event["label"].trim()
          : "Milestone";
      const checkpoint = await this.createCheckpoint({
        userId: input.userId,
        companyId: input.companyId,
        triggerType: input.triggerType,
        source: "system",
        title: `${milestoneLabel} milestone gate`,
        description: "Human review is required before this milestone can advance.",
        recipientType: input.recipientType,
        recipientId: input.recipientId,
        metadata: input.event,
      });
      return { matched: true, reason: "milestone status matches a configured gate", checkpoint };
    }

    if (!schedule.kpiDeviation.enabled) {
      return { matched: false, reason: "kpi deviation trigger is disabled" };
    }
    const metricKey = typeof input.event["metricKey"] === "string" ? input.event["metricKey"] : "";
    const observedValue =
      typeof input.event["observedValue"] === "number" ? input.event["observedValue"] : NaN;
    const thresholdConfig = schedule.kpiDeviation.thresholds.find(
      (threshold) => threshold.metricKey === metricKey,
    );
    if (!thresholdConfig) {
      return { matched: false, reason: "no KPI threshold is configured for the supplied metricKey" };
    }
    if (!Number.isFinite(observedValue)) {
      return { matched: false, reason: "observedValue must be a number" };
    }
    const matched = compareThreshold(
      thresholdConfig.comparator,
      observedValue,
      thresholdConfig.threshold,
    );
    if (!matched) {
      return { matched: false, reason: "observedValue did not breach the configured KPI threshold" };
    }
    const checkpoint = await this.createCheckpoint({
      userId: input.userId,
      companyId: input.companyId,
      triggerType: input.triggerType,
      source: "system",
      title: `${metricKey} KPI deviation`,
      description: "Human review is required because a KPI moved outside its configured threshold.",
      recipientType: input.recipientType,
      recipientId: input.recipientId,
      metadata: {
        ...input.event,
        comparator: thresholdConfig.comparator,
        threshold: thresholdConfig.threshold,
        window: thresholdConfig.window,
      },
    });
    return { matched: true, reason: "observedValue breached the configured KPI threshold", checkpoint };
  },

  async listArtifactComments(
    userId: string,
    companyId: string,
    artifactId?: string,
  ): Promise<HitlArtifactComment[]> {
    if (!postgresAvailable()) {
      return Array.from(artifactComments.values())
        .filter((c) => c.userId === userId && c.companyId === companyId)
        .filter((c) => (artifactId ? c.artifact.id === artifactId : true))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    const pool = getPostgresPool();
    const params: unknown[] = [userId, companyId];
    let where = `user_id = $1 AND company_id = $2`;
    if (artifactId) {
      params.push(artifactId);
      where += ` AND artifact_id = $${params.length}`;
    }
    const result = await pool.query<CommentRow>(
      `SELECT * FROM hitl_artifact_comments WHERE ${where} ORDER BY created_at DESC`,
      params,
    );
    return result.rows.map(mapCommentRow);
  },

  async createArtifactComment(input: {
    userId: string;
    companyId: string;
    artifact: HitlArtifactRef;
    anchor?: HitlArtifactAnchor;
    body: string;
    routing: HitlArtifactComment["routing"];
  }): Promise<HitlArtifactComment> {
    const timestamp = nowIso();
    const schedule = await this.getSchedule(input.userId, input.companyId);
    const notificationRecords = await createNotificationRecords({
      companyId: input.companyId,
      userId: input.userId,
      kind: "artifact_comment",
      recipientType: input.routing.recipientType,
      recipientId: input.routing.recipientId,
      channels: schedule.notificationChannels,
      payload: {
        artifactId: input.artifact.id,
        artifactKind: input.artifact.kind,
        body: input.body,
        reason: input.routing.reason,
      },
    });
    const comment: HitlArtifactComment = {
      id: randomUUID(),
      companyId: input.companyId,
      userId: input.userId,
      artifact: input.artifact,
      anchor: input.anchor,
      body: input.body,
      status: "open",
      routing: input.routing,
      createdAt: timestamp,
      updatedAt: timestamp,
      notificationIds: notificationRecords.map((n) => n.id),
    };

    if (!postgresAvailable()) {
      artifactComments.set(comment.id, comment);
      return comment;
    }

    const pool = getPostgresPool();
    await pool.query(
      `INSERT INTO hitl_artifact_comments (
         id, user_id, company_id,
         artifact_kind, artifact_id, artifact_title, artifact_path, artifact_version,
         anchor_json, body, status, routing_json, notification_ids,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb,$13::jsonb,$14,$15)`,
      [
        comment.id,
        comment.userId,
        comment.companyId,
        comment.artifact.kind,
        comment.artifact.id,
        comment.artifact.title ?? null,
        comment.artifact.path ?? null,
        comment.artifact.version ?? null,
        comment.anchor ? serializeJson(comment.anchor) : null,
        comment.body,
        comment.status,
        serializeJson(comment.routing),
        serializeJson(comment.notificationIds),
        comment.createdAt,
        comment.updatedAt,
      ],
    );
    return comment;
  },

  async createAskCeoRequest(input: {
    userId: string;
    companyId: string;
    question: string;
    context?: AskCeoRequest["context"];
  }): Promise<AskCeoRequest> {
    const createdAt = nowIso();
    const summary = await buildCompanyStateSummary(input.userId, input.companyId);
    const citedEntities: AskCeoRequest["response"]["citedEntities"] = [];
    if (summary.team) {
      citedEntities.push({ type: "team", id: summary.team.id, label: summary.team.name });
    }
    const latestCheckpoint = (await this.listCheckpoints(input.userId, input.companyId))[0];
    if (latestCheckpoint) {
      citedEntities.push({
        type: "checkpoint",
        id: latestCheckpoint.id,
        label: latestCheckpoint.title,
      });
    }
    const latestComment = (await this.listArtifactComments(input.userId, input.companyId))[0];
    if (latestComment) {
      citedEntities.push({
        type: "artifact_comment",
        id: latestComment.id,
        label: latestComment.artifact.title ?? latestComment.artifact.id,
      });
    }
    const request: AskCeoRequest = {
      id: randomUUID(),
      companyId: input.companyId,
      userId: input.userId,
      question: input.question,
      context: input.context,
      status: "answered",
      response: {
        summary: summary.team
          ? `Company ${summary.team.name} has ${summary.team.openTaskCount} open tasks, ${summary.hitl.openCheckpointCount} open checkpoints, and ${summary.team.activeExecutionCount} active executions.`
          : `No control-plane team was found for company ${input.companyId}, but HITL contracts are available and state can accumulate as checkpoints and comments are created.`,
        recommendedActions: [
          "Review newly opened checkpoints before advancing milestones.",
          "Route inline artifact comments to the responsible agent for follow-up.",
          "Use KPI deviation checkpoints to pause automation when a metric moves outside guardrails.",
        ],
        citedEntities,
        companyStateVersion: summary.version,
      },
      createdAt,
    };

    if (!postgresAvailable()) {
      askCeoRequests.set(request.id, request);
    } else {
      const pool = getPostgresPool();
      await pool.query(
        `INSERT INTO hitl_ask_ceo_requests (
           id, user_id, company_id, question, context_json, status, response_json, created_at
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8)`,
        [
          request.id,
          request.userId,
          request.companyId,
          request.question,
          request.context ? serializeJson(request.context) : null,
          request.status,
          serializeJson(request.response),
          request.createdAt,
        ],
      );
    }

    await createNotificationRecords({
      companyId: input.companyId,
      userId: input.userId,
      kind: "ask_ceo_response",
      recipientType: "user",
      recipientId: input.userId,
      channels: ["inbox"],
      payload: { requestId: request.id, summary: request.response.summary },
    });
    return request;
  },

  async getAskCeoRequest(
    userId: string,
    companyId: string,
    requestId: string,
  ): Promise<AskCeoRequest | undefined> {
    if (!postgresAvailable()) {
      const request = askCeoRequests.get(requestId);
      if (!request || request.userId !== userId || request.companyId !== companyId) return undefined;
      return request;
    }

    const pool = getPostgresPool();
    const result = await pool.query<AskCeoRow>(
      `SELECT * FROM hitl_ask_ceo_requests WHERE id = $1 AND user_id = $2 AND company_id = $3`,
      [requestId, userId, companyId],
    );
    return result.rows[0] ? mapAskCeoRow(result.rows[0]) : undefined;
  },

  async listAskCeoRequests(userId: string, companyId: string): Promise<AskCeoRequest[]> {
    if (!postgresAvailable()) {
      return Array.from(askCeoRequests.values())
        .filter((r) => r.userId === userId && r.companyId === companyId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    const pool = getPostgresPool();
    const result = await pool.query<AskCeoRow>(
      `SELECT * FROM hitl_ask_ceo_requests
        WHERE user_id = $1 AND company_id = $2
        ORDER BY created_at DESC`,
      [userId, companyId],
    );
    return result.rows.map(mapAskCeoRow);
  },

  async listNotifications(input: {
    userId: string;
    companyId: string;
    recipientType?: HitlRecipientType;
    recipientId?: string;
    kind?: HitlNotification["kind"];
  }): Promise<HitlNotification[]> {
    if (!postgresAvailable()) {
      return Array.from(notifications.values())
        .filter((n) => n.userId === input.userId && n.companyId === input.companyId)
        .filter((n) => (input.recipientType ? n.recipientType === input.recipientType : true))
        .filter((n) => (input.recipientId ? n.recipientId === input.recipientId : true))
        .filter((n) => (input.kind ? n.kind === input.kind : true))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    const params: unknown[] = [input.userId, input.companyId];
    let where = `user_id = $1 AND company_id = $2`;
    if (input.recipientType) {
      params.push(input.recipientType);
      where += ` AND recipient_type = $${params.length}`;
    }
    if (input.recipientId) {
      params.push(input.recipientId);
      where += ` AND recipient_id = $${params.length}`;
    }
    if (input.kind) {
      params.push(input.kind);
      where += ` AND kind = $${params.length}`;
    }
    const pool = getPostgresPool();
    const result = await pool.query<NotificationRow>(
      `SELECT * FROM hitl_notifications WHERE ${where} ORDER BY created_at DESC`,
      params,
    );
    return result.rows.map(mapNotificationRow);
  },

  async getCompanyState(userId: string, companyId: string) {
    const summary = await buildCompanyStateSummary(userId, companyId);
    const schedule = await this.getSchedule(userId, companyId);
    return {
      companyId,
      version: summary.version,
      summary,
      checkpointSchedule: schedule,
      checkpoints: await this.listCheckpoints(userId, companyId),
      artifactComments: await this.listArtifactComments(userId, companyId),
      askCeoRequests: await this.listAskCeoRequests(userId, companyId),
    };
  },

  async clear(): Promise<void> {
    schedules.clear();
    checkpoints.clear();
    artifactComments.clear();
    askCeoRequests.clear();
    notifications.clear();
    if (!postgresAvailable()) return;
    const pool = getPostgresPool();
    await pool.query(`DELETE FROM hitl_notifications`);
    await pool.query(`DELETE FROM hitl_ask_ceo_requests`);
    await pool.query(`DELETE FROM hitl_artifact_comments`);
    await pool.query(`DELETE FROM hitl_checkpoints`);
    await pool.query(`DELETE FROM hitl_schedules`);
  },
};
