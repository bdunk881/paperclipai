import { TicketActorRef, TicketAssignee, TicketPriority, TicketRecord } from "./ticketStore";

export type TicketSlaState = "untracked" | "on_track" | "at_risk" | "breached" | "paused";
export type TicketSlaPhase = "first_response" | "resolution" | "resolved" | "paused";
export type TicketSlaTargetKind = "minutes" | "business_days";

export interface TicketSlaTarget {
  kind: TicketSlaTargetKind;
  value: number;
}

export interface TicketSlaEscalationPolicy {
  notify: boolean;
  notifyTargets?: string[];
  autoBumpPriority: boolean;
  autoReassign: boolean;
  fallbackAssignee?: TicketActorRef;
}

export interface TicketSlaPolicy {
  id: string;
  workspaceId: string;
  priority: TicketPriority;
  firstResponseTarget: TicketSlaTarget;
  resolutionTarget: TicketSlaTarget;
  atRiskThreshold: number;
  escalation: TicketSlaEscalationPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface TicketSlaSnapshot {
  ticketId: string;
  workspaceId: string;
  policyId: string;
  priority: TicketPriority;
  state: TicketSlaState;
  phase: TicketSlaPhase;
  firstResponseTargetAt: string;
  firstResponseRespondedAt?: string;
  resolutionTargetAt: string;
  pausedAt?: string;
  totalPausedMinutes: number;
  atRiskNotifiedAt?: string;
  breachedAt?: string;
  escalationAppliedAt?: string;
  lastEvaluatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TicketSlaEvaluation {
  snapshot: TicketSlaSnapshot;
  previousState: TicketSlaState;
  enteredAtRisk: boolean;
  enteredBreach: boolean;
}

function addBusinessDays(startAt: Date, businessDays: number): Date {
  const next = new Date(startAt.getTime());
  let remaining = businessDays;
  while (remaining > 0) {
    next.setUTCDate(next.getUTCDate() + 1);
    const day = next.getUTCDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }
  return next;
}

export function addSlaTarget(startAt: string, target: TicketSlaTarget): string {
  const start = new Date(startAt);
  if (target.kind === "minutes") {
    return new Date(start.getTime() + target.value * 60_000).toISOString();
  }
  return addBusinessDays(start, target.value).toISOString();
}

export function defaultPoliciesForWorkspace(workspaceId: string): TicketSlaPolicy[] {
  const now = new Date().toISOString();
  const build = (
    priority: TicketPriority,
    firstResponseTarget: TicketSlaTarget,
    resolutionTarget: TicketSlaTarget,
  ): TicketSlaPolicy => ({
    id: `${workspaceId}:${priority}`,
    workspaceId,
    priority,
    firstResponseTarget,
    resolutionTarget,
    atRiskThreshold: 0.75,
    escalation: {
      notify: true,
      autoBumpPriority: false,
      autoReassign: false,
    },
    createdAt: now,
    updatedAt: now,
  });

  return [
    build("urgent", { kind: "minutes", value: 15 }, { kind: "minutes", value: 240 }),
    build("high", { kind: "minutes", value: 60 }, { kind: "business_days", value: 1 }),
    build("medium", { kind: "minutes", value: 240 }, { kind: "business_days", value: 3 }),
    build("low", { kind: "business_days", value: 1 }, { kind: "business_days", value: 7 }),
  ];
}

export function isPrimaryAssignee(actor: TicketActorRef, assignees: TicketAssignee[]): boolean {
  return assignees.some(
    (assignee) =>
      assignee.role === "primary" && assignee.type === actor.type && assignee.id === actor.id,
  );
}

export function buildSlaSnapshot(ticket: TicketRecord, policy: TicketSlaPolicy): TicketSlaSnapshot {
  const now = new Date().toISOString();
  return {
    ticketId: ticket.id,
    workspaceId: ticket.workspaceId,
    policyId: policy.id,
    priority: ticket.priority,
    state: "on_track",
    phase: "first_response",
    firstResponseTargetAt: addSlaTarget(ticket.createdAt, policy.firstResponseTarget),
    resolutionTargetAt: addSlaTarget(ticket.createdAt, policy.resolutionTarget),
    totalPausedMinutes: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function completeFirstResponse(
  snapshot: TicketSlaSnapshot,
  respondedAt: string,
): TicketSlaSnapshot {
  if (snapshot.firstResponseRespondedAt) {
    return snapshot;
  }

  return {
    ...snapshot,
    firstResponseRespondedAt: respondedAt,
    phase: "resolution",
    updatedAt: respondedAt,
  };
}

export function pauseSla(snapshot: TicketSlaSnapshot, pausedAt: string): TicketSlaSnapshot {
  if (snapshot.pausedAt) {
    return snapshot;
  }

  return {
    ...snapshot,
    state: "paused",
    phase: "paused",
    pausedAt,
    updatedAt: pausedAt,
  };
}

export function resumeSla(snapshot: TicketSlaSnapshot, resumedAt: string): TicketSlaSnapshot {
  if (!snapshot.pausedAt) {
    return snapshot;
  }

  const pausedMs = new Date(resumedAt).getTime() - new Date(snapshot.pausedAt).getTime();
  return {
    ...snapshot,
    pausedAt: undefined,
    totalPausedMinutes: snapshot.totalPausedMinutes + Math.max(0, Math.round(pausedMs / 60_000)),
    phase: snapshot.firstResponseRespondedAt ? "resolution" : "first_response",
    updatedAt: resumedAt,
  };
}

function effectiveDeadline(snapshot: TicketSlaSnapshot): string {
  return snapshot.firstResponseRespondedAt ? snapshot.resolutionTargetAt : snapshot.firstResponseTargetAt;
}

function phaseStartedAt(ticket: TicketRecord, snapshot: TicketSlaSnapshot): string {
  return snapshot.firstResponseRespondedAt ?? ticket.createdAt;
}

export function evaluateSlaState(
  ticket: TicketRecord,
  snapshot: TicketSlaSnapshot,
  now = new Date().toISOString(),
): TicketSlaEvaluation {
  const previousState = snapshot.state;
  if (ticket.status === "resolved" || ticket.status === "cancelled") {
    return {
      previousState,
      enteredAtRisk: false,
      enteredBreach: false,
      snapshot: {
        ...snapshot,
        phase: "resolved",
        state: previousState === "breached" ? "breached" : "on_track",
        lastEvaluatedAt: now,
        updatedAt: now,
      },
    };
  }

  if (snapshot.pausedAt || ticket.status === "blocked") {
    return {
      previousState,
      enteredAtRisk: false,
      enteredBreach: false,
      snapshot: {
        ...snapshot,
        state: "paused",
        phase: "paused",
        lastEvaluatedAt: now,
        updatedAt: now,
      },
    };
  }

  const deadline = new Date(effectiveDeadline(snapshot)).getTime();
  const startedAt = new Date(phaseStartedAt(ticket, snapshot)).getTime();
  const current = new Date(now).getTime();
  const durationMs = Math.max(deadline - startedAt, 1);
  const thresholdMs = startedAt + durationMs * 0.75;

  let nextState: TicketSlaState = "on_track";
  if (current >= deadline) {
    nextState = "breached";
  } else if (current >= thresholdMs) {
    nextState = "at_risk";
  }

  return {
    previousState,
    enteredAtRisk: previousState !== "at_risk" && nextState === "at_risk",
    enteredBreach: previousState !== "breached" && nextState === "breached",
    snapshot: {
      ...snapshot,
      state: nextState,
      phase: snapshot.firstResponseRespondedAt ? "resolution" : "first_response",
      breachedAt: nextState === "breached" ? snapshot.breachedAt ?? now : snapshot.breachedAt,
      lastEvaluatedAt: now,
      updatedAt: now,
    },
  };
}

export function nextPriority(priority: TicketPriority): TicketPriority {
  switch (priority) {
    case "low":
      return "medium";
    case "medium":
      return "high";
    case "high":
      return "urgent";
    default:
      return "urgent";
  }
}
