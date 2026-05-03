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
  workspaceId: string;
  policies: TicketSlaPolicyRow[];
  escalationRules: TicketEscalationRuleRow[];
  fallbackCandidates: TicketActorRef[];
  updatedAt: string;
}

const BASE = getApiBasePath();
const USE_MOCK_API = import.meta.env.VITE_USE_MOCK === "true";
const DEFAULT_WORKSPACE_ID =
  import.meta.env.VITE_DEFAULT_WORKSPACE_ID ?? "11111111-1111-4111-8111-111111111111";
let mockTicketSlaSettings: TicketSlaSettingsPayload = {
  workspaceId: DEFAULT_WORKSPACE_ID,
  policies: [
    { priority: "urgent", firstResponseMinutes: 15, resolutionMinutes: 120 },
    { priority: "high", firstResponseMinutes: 30, resolutionMinutes: 240 },
    { priority: "medium", firstResponseMinutes: 60, resolutionMinutes: 480 },
    { priority: "low", firstResponseMinutes: 240, resolutionMinutes: 1440 },
  ],
  escalationRules: [
    {
      priority: "urgent",
      notifyTargets: ["@CTO", "#incident-room"],
      autoBumpPriority: false,
      autoReassign: true,
      fallbackActor: { type: "agent", id: "frontend-engineer" },
    },
    {
      priority: "high",
      notifyTargets: ["@ops-lead"],
      autoBumpPriority: true,
      autoReassign: true,
      fallbackActor: { type: "agent", id: "backend-engineer" },
    },
    {
      priority: "medium",
      notifyTargets: ["@support-lead"],
      autoBumpPriority: false,
      autoReassign: false,
    },
    {
      priority: "low",
      notifyTargets: ["@support-lead"],
      autoBumpPriority: false,
      autoReassign: false,
    },
  ],
  fallbackCandidates: [
    { type: "agent", id: "frontend-engineer" },
    { type: "agent", id: "backend-engineer" },
    { type: "agent", id: "cto" },
  ],
  updatedAt: "2026-05-02T16:00:00.000Z",
};

const mockTicketSlaDashboard: TicketSlaDashboard = {
  summaryCards: [
    { key: "breach_rate", label: "Breach Rate", value: "6.4%", delta: "-1.2%", trend: "improving" },
    { key: "avg_first_response", label: "Avg First Response", value: "18m", delta: "-4m", trend: "improving" },
    { key: "active_breaches", label: "Active Breaches", value: "3", delta: "+1", trend: "worsening" },
  ],
  resolutionBuckets: [
    { label: "<1h", count: 14, percent: 28 },
    { label: "1-4h", count: 19, percent: 38 },
    { label: "4-8h", count: 10, percent: 20 },
    { label: "8h+", count: 7, percent: 14 },
  ],
  actorBreakdown: [
    {
      actor: { type: "agent", id: "frontend-engineer" },
      activeCount: 6,
      atRiskCount: 2,
      breachedCount: 1,
      avgResolutionHours: 3.8,
    },
    {
      actor: { type: "agent", id: "backend-engineer" },
      activeCount: 5,
      atRiskCount: 1,
      breachedCount: 1,
      avgResolutionHours: 4.6,
    },
    {
      actor: { type: "user", id: "alex.pm" },
      activeCount: 2,
      atRiskCount: 0,
      breachedCount: 0,
      avgResolutionHours: 2.1,
    },
  ],
  priorityBreakdown: [
    { priority: "urgent", activeCount: 2, atRiskCount: 1, breachRate: 12, avgFirstResponseMinutes: 11 },
    { priority: "high", activeCount: 4, atRiskCount: 1, breachRate: 7, avgFirstResponseMinutes: 19 },
    { priority: "medium", activeCount: 5, atRiskCount: 1, breachRate: 4, avgFirstResponseMinutes: 32 },
    { priority: "low", activeCount: 2, atRiskCount: 0, breachRate: 1, avgFirstResponseMinutes: 58 },
  ],
};

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
  if (USE_MOCK_API) {
    return structuredClone(mockTicketSlaDashboard);
  }

  const res = await fetch(`${BASE}/tickets/sla/dashboard?workspaceId=${encodeURIComponent(DEFAULT_WORKSPACE_ID)}`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(`Failed to load SLA dashboard: ${res.status}`);
  }
  return (await res.json()) as TicketSlaDashboard;
}

export async function getTicketSlaSettings(accessToken?: string): Promise<TicketSlaSettingsPayload> {
  if (USE_MOCK_API) {
    return structuredClone(mockTicketSlaSettings);
  }

  const res = await fetch(`${BASE}/tickets/sla/settings?workspaceId=${encodeURIComponent(DEFAULT_WORKSPACE_ID)}`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(`Failed to load SLA settings: ${res.status}`);
  }
  const data = (await res.json()) as TicketSlaSettingsPayload;
  return {
    ...data,
    workspaceId: data.workspaceId ?? DEFAULT_WORKSPACE_ID,
  };
}

export async function updateTicketSlaSettings(
  input: TicketSlaSettingsPayload,
  accessToken?: string
): Promise<TicketSlaSettingsPayload> {
  if (USE_MOCK_API) {
    mockTicketSlaSettings = structuredClone({
      ...input,
      updatedAt: new Date().toISOString(),
    });
    return structuredClone(mockTicketSlaSettings);
  }

  const res = await fetch(`${BASE}/tickets/sla/settings`, {
    method: "PATCH",
    headers: buildMutationHeaders(accessToken),
    body: JSON.stringify({
      ...input,
      workspaceId: input.workspaceId || DEFAULT_WORKSPACE_ID,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to save SLA settings: ${res.status}`);
  }
  return (await res.json()) as TicketSlaSettingsPayload;
}

export function formatFallbackActor(actor?: TicketActorRef): string {
  return actor ? getTicketActorProfile(actor).name : "Required";
}
