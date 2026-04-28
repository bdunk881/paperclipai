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

let mockSettings: TicketSlaSettingsPayload = {
  policies: [
    { priority: "urgent", firstResponseMinutes: 15, resolutionMinutes: 240 },
    { priority: "high", firstResponseMinutes: 60, resolutionMinutes: 480 },
    { priority: "medium", firstResponseMinutes: 240, resolutionMinutes: 1440 },
    { priority: "low", firstResponseMinutes: 480, resolutionMinutes: 4320 },
  ],
  escalationRules: [
    {
      priority: "urgent",
      notifyTargets: ["@CTO", "#incident-room"],
      autoBumpPriority: false,
      autoReassign: true,
      fallbackActor: { type: "agent", id: "cto" },
    },
    {
      priority: "high",
      notifyTargets: ["@Frontend Engineer", "@Alex Mercer"],
      autoBumpPriority: true,
      autoReassign: false,
    },
    {
      priority: "medium",
      notifyTargets: ["support@autoflow.ai"],
      autoBumpPriority: false,
      autoReassign: false,
    },
    {
      priority: "low",
      notifyTargets: ["ops@autoflow.ai"],
      autoBumpPriority: false,
      autoReassign: false,
    },
  ],
  fallbackCandidates: [
    { type: "agent", id: "frontend-engineer" },
    { type: "agent", id: "backend-engineer" },
    { type: "agent", id: "cto" },
    { type: "user", id: "alex.pm" },
    { type: "user", id: "sam.support" },
  ],
  updatedAt: "2026-04-24T02:10:00.000Z",
};

const mockDashboard: TicketSlaDashboard = {
  summaryCards: [
    { key: "breach_rate", label: "Breach Rate", value: "8.4%", delta: "-1.2%", trend: "improving" },
    { key: "avg_first_response", label: "Avg Time to First Response", value: "42m", delta: "-6m", trend: "improving" },
    { key: "active_breaches", label: "Active Breaches", value: "3", delta: "+1", trend: "worsening" },
  ],
  resolutionBuckets: [
    { label: "<1h", count: 14, percent: 18 },
    { label: "1-4h", count: 28, percent: 35 },
    { label: "4-24h", count: 21, percent: 26 },
    { label: "1-3d", count: 11, percent: 14 },
    { label: "3d+", count: 6, percent: 7 },
  ],
  actorBreakdown: [
    { actor: { type: "agent", id: "frontend-engineer" }, activeCount: 9, atRiskCount: 2, breachedCount: 1, avgResolutionHours: 7.4 },
    { actor: { type: "agent", id: "backend-engineer" }, activeCount: 12, atRiskCount: 1, breachedCount: 1, avgResolutionHours: 5.9 },
    { actor: { type: "user", id: "sam.support" }, activeCount: 6, atRiskCount: 1, breachedCount: 0, avgResolutionHours: 3.6 },
  ],
  priorityBreakdown: [
    { priority: "urgent", activeCount: 4, atRiskCount: 1, breachRate: 16, avgFirstResponseMinutes: 12 },
    { priority: "high", activeCount: 13, atRiskCount: 2, breachRate: 9, avgFirstResponseMinutes: 38 },
    { priority: "medium", activeCount: 18, atRiskCount: 1, breachRate: 5, avgFirstResponseMinutes: 64 },
    { priority: "low", activeCount: 7, atRiskCount: 0, breachRate: 2, avgFirstResponseMinutes: 118 },
  ],
};

function cloneActor(actor: TicketActorRef): TicketActorRef {
  return { ...actor };
}

function cloneDashboard(data: TicketSlaDashboard): TicketSlaDashboard {
  return {
    summaryCards: data.summaryCards.map((card) => ({ ...card })),
    resolutionBuckets: data.resolutionBuckets.map((bucket) => ({ ...bucket })),
    actorBreakdown: data.actorBreakdown.map((row) => ({ ...row, actor: cloneActor(row.actor) })),
    priorityBreakdown: data.priorityBreakdown.map((row) => ({ ...row })),
  };
}

function cloneSettings(data: TicketSlaSettingsPayload): TicketSlaSettingsPayload {
  return {
    policies: data.policies.map((policy) => ({ ...policy })),
    escalationRules: data.escalationRules.map((rule) => ({
      ...rule,
      notifyTargets: [...rule.notifyTargets],
      fallbackActor: rule.fallbackActor ? cloneActor(rule.fallbackActor) : undefined,
    })),
    fallbackCandidates: data.fallbackCandidates.map(cloneActor),
    updatedAt: data.updatedAt,
  };
}

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

function isMockFallbackStatus(status: number): boolean {
  return status === 404 || status === 405 || status === 500 || status === 501 || status === 503;
}

function withMockFallback<T>(factory: () => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
  return factory().catch(() => Promise.resolve(fallback()));
}

export async function getTicketSlaDashboard(accessToken?: string): Promise<TicketSlaDashboard> {
  return withMockFallback(
    async () => {
      const res = await fetch(`${BASE}/tickets/sla/dashboard`, {
        headers: buildAuthHeaders(accessToken),
      });
      if (!res.ok) {
        if (isMockFallbackStatus(res.status)) throw new Error("fallback");
        throw new Error(`Failed to load SLA dashboard: ${res.status}`);
      }
      return (await res.json()) as TicketSlaDashboard;
    },
    () => cloneDashboard(mockDashboard)
  );
}

export async function getTicketSlaSettings(accessToken?: string): Promise<TicketSlaSettingsPayload> {
  return withMockFallback(
    async () => {
      const res = await fetch(`${BASE}/tickets/sla/policies`, {
        headers: buildAuthHeaders(accessToken),
      });
      if (!res.ok) {
        if (isMockFallbackStatus(res.status)) throw new Error("fallback");
        throw new Error(`Failed to load SLA settings: ${res.status}`);
      }
      return (await res.json()) as TicketSlaSettingsPayload;
    },
    () => cloneSettings(mockSettings)
  );
}

export async function updateTicketSlaSettings(
  input: TicketSlaSettingsPayload,
  accessToken?: string
): Promise<TicketSlaSettingsPayload> {
  return withMockFallback(
    async () => {
      const res = await fetch(`${BASE}/tickets/sla/policies`, {
        method: "PATCH",
        headers: buildMutationHeaders(accessToken),
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        if (isMockFallbackStatus(res.status)) throw new Error("fallback");
        throw new Error(`Failed to save SLA settings: ${res.status}`);
      }
      return (await res.json()) as TicketSlaSettingsPayload;
    },
    () => {
      mockSettings = cloneSettings({ ...input, updatedAt: new Date().toISOString() });
      return cloneSettings(mockSettings);
    }
  );
}

export function formatFallbackActor(actor?: TicketActorRef): string {
  return actor ? getTicketActorProfile(actor).name : "Required";
}
