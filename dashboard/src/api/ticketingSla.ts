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
const USE_MOCK_TICKETING = import.meta.env.VITE_USE_MOCK === "true";

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

function cloneActor(actor: TicketActorRef): TicketActorRef {
  return { ...actor };
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
  return factory().catch((error) => {
    if (!USE_MOCK_TICKETING) {
      if (error instanceof Error && error.message === "fallback") {
        throw new Error("Live ticketing SLA data is unavailable and mock fallback is disabled.");
      }
      throw error;
    }

    return Promise.resolve(fallback());
  });
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
