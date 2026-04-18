export type AgentCategory = "Sales" | "Operations" | "Engineering" | "Support" | "Marketing";
export type AgentPricingTier = "Starter" | "Growth" | "Scale";

export interface AgentTemplate {
  id: string;
  name: string;
  category: AgentCategory;
  description: string;
  capabilities: string[];
  requiredIntegrations: string[];
  optionalIntegrations: string[];
  pricingTier: AgentPricingTier;
  monthlyPriceUsd: number;
}

export type DeployedAgentStatus = "running" | "paused" | "deploying";

export interface DeployedAgent {
  id: string;
  templateId: string;
  templateName: string;
  name: string;
  status: DeployedAgentStatus;
  permissions: string[];
  integrations: string[];
  deployedAt: string;
  lastActiveAt: string;
  tokenUsage24h: number;
}

export type ActivityStatus = "success" | "warning" | "info";

export interface AgentActivityItem {
  id: string;
  agentName: string;
  action: string;
  status: ActivityStatus;
  tokenUsage: number;
  createdAt: string;
  summary: string;
}

const DEPLOYMENTS_KEY = "autoflow:agent-deployments";
const ACTIVITY_KEY = "autoflow:agent-activity";

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "sales-prospecting",
    name: "Sales Prospecting Agent",
    category: "Sales",
    description: "Sources leads, enriches records, and drafts personalized outbound sequences.",
    capabilities: [
      "Lead discovery with ICP filters",
      "Account enrichment and scoring",
      "Personalized outbound drafting",
    ],
    requiredIntegrations: ["Apollo", "CRM"],
    optionalIntegrations: ["Slack", "Email"],
    pricingTier: "Growth",
    monthlyPriceUsd: 79,
  },
  {
    id: "ops-intake",
    name: "Ops Intake Agent",
    category: "Operations",
    description: "Classifies incoming requests, routes tickets, and enforces SLA priorities.",
    capabilities: [
      "Request classification",
      "Automated queue routing",
      "SLA breach escalation",
    ],
    requiredIntegrations: ["Helpdesk"],
    optionalIntegrations: ["Slack", "Notion"],
    pricingTier: "Starter",
    monthlyPriceUsd: 39,
  },
  {
    id: "engineering-triage",
    name: "Engineering Triage Agent",
    category: "Engineering",
    description: "Analyzes incidents, clusters errors, and drafts fix recommendations.",
    capabilities: [
      "Log pattern clustering",
      "Incident summarization",
      "Suggested remediation steps",
    ],
    requiredIntegrations: ["GitHub", "Observability"],
    optionalIntegrations: ["PagerDuty", "Slack"],
    pricingTier: "Scale",
    monthlyPriceUsd: 149,
  },
  {
    id: "support-deflection",
    name: "Support Deflection Agent",
    category: "Support",
    description: "Handles Tier 1 requests, resolves known issues, and escalates edge cases.",
    capabilities: [
      "Intent classification",
      "Knowledge base grounded responses",
      "Escalation with context handoff",
    ],
    requiredIntegrations: ["Helpdesk", "Knowledge Base"],
    optionalIntegrations: ["Slack"],
    pricingTier: "Growth",
    monthlyPriceUsd: 69,
  },
  {
    id: "campaign-optimizer",
    name: "Campaign Optimizer Agent",
    category: "Marketing",
    description: "Monitors campaign performance and proposes budget/channel shifts.",
    capabilities: [
      "Performance monitoring",
      "Budget reallocation suggestions",
      "Audience segment insights",
    ],
    requiredIntegrations: ["Ads Platform"],
    optionalIntegrations: ["Analytics", "Slack"],
    pricingTier: "Growth",
    monthlyPriceUsd: 89,
  },
];

const DEFAULT_DEPLOYMENTS: DeployedAgent[] = [
  {
    id: "dep_sales_001",
    templateId: "sales-prospecting",
    templateName: "Sales Prospecting Agent",
    name: "Outbound SDR Agent",
    status: "running",
    permissions: ["read", "execute"],
    integrations: ["Apollo", "CRM", "Slack"],
    deployedAt: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
    lastActiveAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
    tokenUsage24h: 19840,
  },
  {
    id: "dep_ops_001",
    templateId: "ops-intake",
    templateName: "Ops Intake Agent",
    name: "Ops Queue Router",
    status: "paused",
    permissions: ["read", "write"],
    integrations: ["Helpdesk", "Notion"],
    deployedAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
    lastActiveAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
    tokenUsage24h: 6240,
  },
];

const DEFAULT_ACTIVITY: AgentActivityItem[] = [
  {
    id: "act_001",
    agentName: "Outbound SDR Agent",
    action: "Lead batch processed",
    status: "success",
    tokenUsage: 1240,
    createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    summary: "Processed 40 leads and generated outbound drafts for 28 prospects.",
  },
  {
    id: "act_002",
    agentName: "Ops Queue Router",
    action: "SLA escalation",
    status: "warning",
    tokenUsage: 480,
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    summary: "Escalated 3 P1 tickets after SLA threshold exceeded.",
  },
  {
    id: "act_003",
    agentName: "Outbound SDR Agent",
    action: "Integration health check",
    status: "info",
    tokenUsage: 95,
    createdAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    summary: "Apollo sync completed with no record mismatch.",
  },
];

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const storage = window.localStorage;
  if (!storage || typeof storage.getItem !== "function") return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  const storage = window.localStorage;
  if (!storage || typeof storage.setItem !== "function") return;
  storage.setItem(key, JSON.stringify(value));
}

export function listAgentTemplates(): AgentTemplate[] {
  return AGENT_TEMPLATES;
}

export function getAgentTemplate(templateId: string): AgentTemplate | null {
  return AGENT_TEMPLATES.find((template) => template.id === templateId) ?? null;
}

export function listDeployments(): DeployedAgent[] {
  const stored = readJson<DeployedAgent[] | null>(DEPLOYMENTS_KEY, null);
  if (stored && Array.isArray(stored)) return stored;
  writeJson(DEPLOYMENTS_KEY, DEFAULT_DEPLOYMENTS);
  return DEFAULT_DEPLOYMENTS;
}

export function saveDeployments(next: DeployedAgent[]) {
  writeJson(DEPLOYMENTS_KEY, next);
}

export function listAgentActivity(): AgentActivityItem[] {
  const stored = readJson<AgentActivityItem[] | null>(ACTIVITY_KEY, null);
  if (stored && Array.isArray(stored)) return stored;
  writeJson(ACTIVITY_KEY, DEFAULT_ACTIVITY);
  return DEFAULT_ACTIVITY;
}

export function saveAgentActivity(next: AgentActivityItem[]) {
  writeJson(ACTIVITY_KEY, next);
}

export function appendAgentActivity(activity: Omit<AgentActivityItem, "id" | "createdAt">) {
  const current = listAgentActivity();
  const nextItem: AgentActivityItem = {
    id: `act_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    createdAt: new Date().toISOString(),
    ...activity,
  };
  const next = [nextItem, ...current].slice(0, 100);
  saveAgentActivity(next);
}

export function createDeployment(input: {
  template: AgentTemplate;
  name: string;
  permissions: string[];
  integrations: string[];
}) {
  const current = listDeployments();
  const now = new Date().toISOString();
  const deployment: DeployedAgent = {
    id: `dep_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    templateId: input.template.id,
    templateName: input.template.name,
    name: input.name,
    status: "running",
    permissions: input.permissions,
    integrations: input.integrations,
    deployedAt: now,
    lastActiveAt: now,
    tokenUsage24h: Math.floor(Math.random() * 5000) + 900,
  };

  saveDeployments([deployment, ...current]);

  appendAgentActivity({
    agentName: deployment.name,
    action: "Deployment completed",
    status: "success",
    tokenUsage: 420,
    summary: `${deployment.templateName} deployed with ${deployment.integrations.length} integrations connected.`,
  });

  return deployment;
}
