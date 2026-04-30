import { randomUUID } from "crypto";
import { controlPlaneStore } from "../controlPlane/controlPlaneStore";

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

function defaultSchedule(userId: string, companyId: string): HitlCheckpointSchedule {
  const timestamp = nowIso();
  return {
    id: randomUUID(),
    companyId,
    userId,
    enabled: true,
    timezone: "UTC",
    notificationChannels: ["inbox", "agent_wake"],
    weeklyReview: {
      enabled: true,
      dayOfWeek: 5,
      hour: 16,
      minute: 0,
    },
    milestoneGate: {
      enabled: true,
      blockingStatuses: ["at_risk", "ready_for_review", "blocked"],
    },
    kpiDeviation: {
      enabled: true,
      thresholds: [],
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createNotification(input: {
  companyId: string;
  userId: string;
  kind: HitlNotification["kind"];
  recipientType: HitlRecipientType;
  recipientId: string;
  channels: HitlNotificationChannel[];
  payload: Record<string, unknown>;
}): HitlNotification[] {
  const createdAt = nowIso();
  return input.channels.map((channel) => {
    const notification: HitlNotification = {
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
    };
    notifications.set(notification.id, notification);
    return notification;
  });
}

function compareThreshold(
  comparator: HitlKpiThreshold["comparator"],
  observedValue: number,
  threshold: number
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

function buildCompanyStateSummary(userId: string, companyId: string): CompanyStateSummary {
  const team = controlPlaneStore.getTeam(companyId, userId);
  const teamAgents = team ? controlPlaneStore.listAgents(team.id, userId) : [];
  const teamExecutions = team ? controlPlaneStore.listExecutions(userId, team.id) : [];
  const teamTasks = team ? controlPlaneStore.listTasks(userId, team.id) : [];
  const companyCheckpoints = Array.from(checkpoints.values()).filter(
    (checkpoint) => checkpoint.userId === userId && checkpoint.companyId === companyId
  );
  const companyComments = Array.from(artifactComments.values()).filter(
    (comment) => comment.userId === userId && comment.companyId === companyId
  );
  const companyAskCeo = Array.from(askCeoRequests.values()).filter(
    (request) => request.userId === userId && request.companyId === companyId
  );

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
          activeExecutionCount: teamExecutions.filter((execution) => execution.status === "running").length,
          openTaskCount: teamTasks.filter((task) => ["todo", "in_progress", "blocked"].includes(task.status))
            .length,
        }
      : null,
    hitl: {
      openCheckpointCount: companyCheckpoints.filter((checkpoint) =>
        ["pending", "acknowledged"].includes(checkpoint.status)
      ).length,
      unresolvedCommentCount: companyComments.filter((comment) => comment.status === "open").length,
      askCeoRequestCount: companyAskCeo.length,
    },
  };
}

export const hitlStore = {
  getSchedule(userId: string, companyId: string): HitlCheckpointSchedule {
    const key = scheduleKey(userId, companyId);
    const existing = schedules.get(key);
    if (existing) {
      return existing;
    }
    const created = defaultSchedule(userId, companyId);
    schedules.set(key, created);
    return created;
  },

  upsertSchedule(
    userId: string,
    companyId: string,
    input: HitlCheckpointScheduleUpdate
  ): HitlCheckpointSchedule {
    const current = this.getSchedule(userId, companyId);
    const updated: HitlCheckpointSchedule = {
      ...current,
      ...input,
      weeklyReview: {
        ...current.weeklyReview,
        ...input.weeklyReview,
      },
      milestoneGate: {
        ...current.milestoneGate,
        ...input.milestoneGate,
      },
      kpiDeviation: {
        ...current.kpiDeviation,
        ...input.kpiDeviation,
        thresholds: input.kpiDeviation?.thresholds ?? current.kpiDeviation.thresholds,
      },
      notificationChannels: input.notificationChannels ?? current.notificationChannels,
      updatedAt: nowIso(),
    };
    schedules.set(scheduleKey(userId, companyId), updated);
    return updated;
  },

  listCheckpoints(userId: string, companyId: string, status?: HitlCheckpointStatus): HitlCheckpoint[] {
    return Array.from(checkpoints.values())
      .filter((checkpoint) => checkpoint.userId === userId && checkpoint.companyId === companyId)
      .filter((checkpoint) => (status ? checkpoint.status === status : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },

  createCheckpoint(input: {
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
  }): HitlCheckpoint {
    const timestamp = nowIso();
    const schedule = this.getSchedule(input.userId, input.companyId);
    const notificationRecords = createNotification({
      companyId: input.companyId,
      userId: input.userId,
      kind: "checkpoint",
      recipientType: input.recipientType,
      recipientId: input.recipientId,
      channels: schedule.notificationChannels,
      payload: {
        triggerType: input.triggerType,
        title: input.title,
        dueAt: input.dueAt,
      },
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
      notificationIds: notificationRecords.map((notification) => notification.id),
    };
    checkpoints.set(checkpoint.id, checkpoint);
    return checkpoint;
  },

  evaluateDefaultTrigger(input: {
    userId: string;
    companyId: string;
    recipientType: HitlRecipientType;
    recipientId: string;
    triggerType: Exclude<HitlCheckpointTriggerType, "manual">;
    event: Record<string, unknown>;
  }): { matched: boolean; reason: string; checkpoint?: HitlCheckpoint } {
    const schedule = this.getSchedule(input.userId, input.companyId);
    if (!schedule.enabled) {
      return { matched: false, reason: "company checkpoint schedule is disabled" };
    }

    if (input.triggerType === "end_of_week_review") {
      if (!schedule.weeklyReview.enabled) {
        return { matched: false, reason: "weekly review trigger is disabled" };
      }
      const evaluatedAt = typeof input.event["evaluatedAt"] === "string"
        ? new Date(input.event["evaluatedAt"])
        : new Date();
      if (Number.isNaN(evaluatedAt.getTime())) {
        return { matched: false, reason: "evaluatedAt must be an ISO timestamp when provided" };
      }
      if (evaluatedAt.getUTCDay() !== schedule.weeklyReview.dayOfWeek) {
        return { matched: false, reason: "current day does not match the configured weekly review window" };
      }
      const checkpoint = this.createCheckpoint({
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
        return { matched: false, reason: "milestone status is not configured to open a checkpoint" };
      }
      const milestoneLabel =
        typeof input.event["label"] === "string" && input.event["label"].trim()
          ? input.event["label"].trim()
          : "Milestone";
      const checkpoint = this.createCheckpoint({
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
    const observedValue = typeof input.event["observedValue"] === "number" ? input.event["observedValue"] : NaN;
    const thresholdConfig = schedule.kpiDeviation.thresholds.find(
      (threshold) => threshold.metricKey === metricKey
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
      thresholdConfig.threshold
    );
    if (!matched) {
      return { matched: false, reason: "observedValue did not breach the configured KPI threshold" };
    }
    const checkpoint = this.createCheckpoint({
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

  listArtifactComments(userId: string, companyId: string, artifactId?: string): HitlArtifactComment[] {
    return Array.from(artifactComments.values())
      .filter((comment) => comment.userId === userId && comment.companyId === companyId)
      .filter((comment) => (artifactId ? comment.artifact.id === artifactId : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },

  createArtifactComment(input: {
    userId: string;
    companyId: string;
    artifact: HitlArtifactRef;
    anchor?: HitlArtifactAnchor;
    body: string;
    routing: HitlArtifactComment["routing"];
  }): HitlArtifactComment {
    const timestamp = nowIso();
    const schedule = this.getSchedule(input.userId, input.companyId);
    const notificationRecords = createNotification({
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
      notificationIds: notificationRecords.map((notification) => notification.id),
    };
    artifactComments.set(comment.id, comment);
    return comment;
  },

  createAskCeoRequest(input: {
    userId: string;
    companyId: string;
    question: string;
    context?: AskCeoRequest["context"];
  }): AskCeoRequest {
    const createdAt = nowIso();
    const summary = buildCompanyStateSummary(input.userId, input.companyId);
    const citedEntities: AskCeoRequest["response"]["citedEntities"] = [];
    if (summary.team) {
      citedEntities.push({
        type: "team",
        id: summary.team.id,
        label: summary.team.name,
      });
    }
    const latestCheckpoint = this.listCheckpoints(input.userId, input.companyId)[0];
    if (latestCheckpoint) {
      citedEntities.push({
        type: "checkpoint",
        id: latestCheckpoint.id,
        label: latestCheckpoint.title,
      });
    }
    const latestComment = this.listArtifactComments(input.userId, input.companyId)[0];
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
    askCeoRequests.set(request.id, request);
    createNotification({
      companyId: input.companyId,
      userId: input.userId,
      kind: "ask_ceo_response",
      recipientType: "user",
      recipientId: input.userId,
      channels: ["inbox"],
      payload: {
        requestId: request.id,
        summary: request.response.summary,
      },
    });
    return request;
  },

  getAskCeoRequest(userId: string, companyId: string, requestId: string): AskCeoRequest | undefined {
    const request = askCeoRequests.get(requestId);
    if (!request || request.userId !== userId || request.companyId !== companyId) {
      return undefined;
    }
    return request;
  },

  listNotifications(input: {
    userId: string;
    companyId: string;
    recipientType?: HitlRecipientType;
    recipientId?: string;
    kind?: HitlNotification["kind"];
  }): HitlNotification[] {
    return Array.from(notifications.values())
      .filter((notification) => notification.userId === input.userId && notification.companyId === input.companyId)
      .filter((notification) => (input.recipientType ? notification.recipientType === input.recipientType : true))
      .filter((notification) => (input.recipientId ? notification.recipientId === input.recipientId : true))
      .filter((notification) => (input.kind ? notification.kind === input.kind : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },

  getCompanyState(userId: string, companyId: string) {
    const summary = buildCompanyStateSummary(userId, companyId);
    const schedule = this.getSchedule(userId, companyId);
    return {
      companyId,
      version: summary.version,
      summary,
      checkpointSchedule: schedule,
      checkpoints: this.listCheckpoints(userId, companyId),
      artifactComments: this.listArtifactComments(userId, companyId),
      askCeoRequests: Array.from(askCeoRequests.values())
        .filter((request) => request.userId === userId && request.companyId === companyId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    };
  },

  clear(): void {
    schedules.clear();
    checkpoints.clear();
    artifactComments.clear();
    askCeoRequests.clear();
    notifications.clear();
  },
};
