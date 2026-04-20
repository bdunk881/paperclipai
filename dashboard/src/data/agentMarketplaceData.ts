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

export const AGENT_TEMPLATES: AgentTemplate[] = [];

const DEFAULT_DEPLOYMENTS: DeployedAgent[] = [];

const DEFAULT_ACTIVITY: AgentActivityItem[] = [];

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
