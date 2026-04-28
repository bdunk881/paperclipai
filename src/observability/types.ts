export type ObservabilityEventCategory = "issue" | "run" | "heartbeat" | "budget" | "alert";
export type ObservabilityActorType = "agent" | "user" | "system" | "run";
export type ObservabilitySubjectType = "team" | "agent" | "task" | "execution" | "ticket" | "workspace";

export interface ObservabilityActorRef {
  type: ObservabilityActorType;
  id: string;
  label?: string;
}

export interface ObservabilitySubjectRef {
  type: ObservabilitySubjectType;
  id: string;
  label?: string;
  parentType?: ObservabilitySubjectType;
  parentId?: string;
}

export interface ObservabilityIssuePayload {
  status?: string;
  previousStatus?: string;
  sourceRunId?: string;
  sourceWorkflowStepId?: string;
  metadata?: Record<string, unknown>;
}

export interface ObservabilityRunPayload {
  status: "running" | "completed" | "blocked" | "failed" | "stopped";
  sourceRunId: string;
  workflowStepId: string;
  workflowStepName: string;
  taskId?: string;
  costUsd?: number;
  metadata?: Record<string, unknown>;
}

export interface ObservabilityHeartbeatPayload {
  status: "queued" | "running" | "completed" | "blocked";
  executionId?: string;
  createdTaskIds: string[];
  costUsd?: number;
}

export interface ObservabilityBudgetPayload {
  deltaUsd: number;
  executionId?: string;
  period: string;
}

export interface ObservabilityAlertPayload {
  severity: "info" | "warning" | "critical";
  code: string;
  sourceCategory: ObservabilityEventCategory;
  sourceId: string;
  executionId?: string;
}

export type ObservabilityEventPayload =
  | ObservabilityIssuePayload
  | ObservabilityRunPayload
  | ObservabilityHeartbeatPayload
  | ObservabilityBudgetPayload
  | ObservabilityAlertPayload;

export interface ObservabilityEvent {
  id: string;
  sequence: string;
  userId: string;
  category: ObservabilityEventCategory;
  type: string;
  actor: ObservabilityActorRef;
  subject: ObservabilitySubjectRef;
  summary: string;
  payload: ObservabilityEventPayload;
  occurredAt: string;
}

export interface ObservabilityEventInput {
  userId: string;
  category: ObservabilityEventCategory;
  type: string;
  actor: ObservabilityActorRef;
  subject: ObservabilitySubjectRef;
  summary: string;
  payload: ObservabilityEventPayload;
  occurredAt?: string;
}

export interface ObservabilityEventQuery {
  userId: string;
  after?: string;
  categories?: ObservabilityEventCategory[];
  limit?: number;
}

export interface ObservabilityFeedPage {
  events: ObservabilityEvent[];
  nextCursor: string | null;
  hasMore: boolean;
  generatedAt: string;
}

export interface ObservabilityThroughputBucket {
  bucketStart: string;
  createdCount: number;
  completedCount: number;
  blockedCount: number;
}

export interface ObservabilityThroughputSnapshot {
  windowHours: number;
  generatedAt: string;
  summary: {
    createdCount: number;
    completedCount: number;
    blockedCount: number;
    completionRate: number;
  };
  buckets: ObservabilityThroughputBucket[];
}
