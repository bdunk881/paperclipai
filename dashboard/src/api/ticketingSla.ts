import { getApiBasePath } from "./baseUrl";
import { getTicketActorProfile, type TicketActorRef, type TicketPriority } from "./tickets";

export interface SlaSummaryCard {
  key: "breach_rate" | "avg_first_response" | "active_breaches";
  label: string;
  value: string;
  delta: string;
  trend: "improving" | "worsening";
}

export interface SlaDistributionBucket {
  label: string;
  count: number;
  percent: number;
}

export interface SlaActorBreakdownRow {
  actor: TicketActorRef;
  activeCount: number;
  atRiskCount: number;
  breachedCount: number;
  avgResolutionHours: number;
}

export interface SlaPriorityBreakdownRow {
  priority: TicketPriority;
  activeCount: number;
  atRiskCount: number;
  breachRate: number;
  avgFirstResponseMinutes: number;
}

export interface TicketSlaDashboard {
  summaryCards: SlaSummaryCard[];
  resolutionBuckets: SlaDistributionBucket[];
  actorBreakdown: SlaActorBreakdownRow[];
  priorityBreakdown: SlaPriorityBreakdownRow[];
}

export interface TicketSlaPolicyRow {
  priority: TicketPriority;
  firstResponseMinutes: number;
  resolutionMinutes: number;
}

export interface TicketEscalationRuleRow {
  priority: TicketPriority;
  notifyTargets: string[];
  autoBumpPriority: boolean;
  autoReassign: boolean;
  fallbackActor?: TicketActorRef;
}

export interface TicketSlaSettingsPayload {
  policies: TicketSlaPolicyRow[];
  escalationRules: TicketEscalationRuleRow[];
  fallbackCandidates: TicketActorRef[];
  updatedAt: string;
}

const BASE = getApiBasePath();

function buildAuthHeaders(accessToken?: string): HeadersInit {
  if (!accessToken) return {};
  return { Authorization: `Bearer ${accessToken}` };
}

function buildMutationHeaders(accessToken?: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...buildAuthHeaders(accessToken),
    "X-Paperclip-Run-Id": crypto.randomUUID(),
  };
}

export async function getTicketSlaDashboard(accessToken?: string): Promise<TicketSlaDashboard> {
  const res = await fetch(`${BASE}/tickets/sla/dashboard`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(`Failed to load SLA dashboard: ${res.status}`);
  }
  return (await res.json()) as TicketSlaDashboard;
}

export async function getTicketSlaSettings(accessToken?: string): Promise<TicketSlaSettingsPayload> {
  const res = await fetch(`${BASE}/tickets/sla/settings`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(`Failed to load SLA settings: ${res.status}`);
  }
  return (await res.json()) as TicketSlaSettingsPayload;
}

export async function updateTicketSlaSettings(
  input: TicketSlaSettingsPayload,
  accessToken?: string
): Promise<TicketSlaSettingsPayload> {
  const res = await fetch(`${BASE}/tickets/sla/settings`, {
    method: "PATCH",
    headers: buildMutationHeaders(accessToken),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Failed to save SLA settings: ${res.status}`);
  }
  return (await res.json()) as TicketSlaSettingsPayload;
}

export function formatFallbackActor(actor?: TicketActorRef): string {
  return actor ? getTicketActorProfile(actor).name : "Required";
}
