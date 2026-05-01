export type AgentCategory = "Sales" | "Operations" | "Engineering" | "Support" | "Marketing" | "Success";
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
  tileIcon?: string;
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
    capabilities: ["Lead discovery", "Account enrichment", "Outbound drafting"],
    requiredIntegrations: ["Apollo", "HubSpot"],
    optionalIntegrations: ["Slack", "Gmail"],
    pricingTier: "Growth",
    monthlyPriceUsd: 79,
    tileIcon: "sales-prospecting.svg",
  },
  {
    id: "lead-enrichment",
    name: "Lead Enrichment Agent",
    category: "Sales",
    description: "Enriches leads with social and firmographic data to improve conversion.",
    capabilities: ["Data enrichment", "Social scraping", "Firmographic analysis"],
    requiredIntegrations: ["HubSpot", "Apollo"],
    optionalIntegrations: ["Clearbit", "Slack"],
    pricingTier: "Starter",
    monthlyPriceUsd: 49,
    tileIcon: "lead-enrichment.svg",
  },
  {
    id: "revenue-ops",
    name: "Revenue Ops Agent",
    category: "Sales",
    description: "Optimizes funnel and revenue forecasting with automated pipeline hygiene.",
    capabilities: ["Pipeline hygiene", "Forecast automation", "Funnel optimization"],
    requiredIntegrations: ["Salesforce", "HubSpot"],
    optionalIntegrations: ["Slack", "Notion"],
    pricingTier: "Scale",
    monthlyPriceUsd: 129,
    tileIcon: "revenue-ops.svg",
  },
  {
    id: "ops-intake",
    name: "Ops Intake Agent",
    category: "Operations",
    description: "Classifies incoming requests, routes tickets, and enforces SLA priorities.",
    capabilities: ["Request classification", "Queue routing", "SLA escalation"],
    requiredIntegrations: ["Zendesk"],
    optionalIntegrations: ["Slack", "Notion"],
    pricingTier: "Starter",
    monthlyPriceUsd: 39,
    tileIcon: "ops-intake.svg",
  },
  {
    id: "compliance-checker",
    name: "Compliance Checker Agent",
    category: "Operations",
    description: "Audits workflows for regulatory compliance and flags potential risks.",
    capabilities: ["Regulatory audit", "Risk assessment", "Policy enforcement"],
    requiredIntegrations: ["Docusign", "PostgreSQL"],
    optionalIntegrations: ["Slack"],
    pricingTier: "Scale",
    monthlyPriceUsd: 199,
    tileIcon: "compliance-checker.svg",
  },
  {
    id: "hiring-pipeline",
    name: "Hiring Pipeline Agent",
    category: "Operations",
    description: "Sources candidates and manages technical screening cycles.",
    capabilities: ["Candidate sourcing", "Screening automation", "Interview scheduling"],
    requiredIntegrations: ["Slack", "GitHub"],
    optionalIntegrations: ["Notion", "LinkedIn"],
    pricingTier: "Growth",
    monthlyPriceUsd: 89,
    tileIcon: "hiring-pipeline.svg",
  },
  {
    id: "it-automation",
    name: "IT Automation Agent",
    category: "Operations",
    description: "Manages user access and hardware provisioning across the org.",
    capabilities: ["Access management", "Provisioning", "Support triage"],
    requiredIntegrations: ["Azure Monitor", "Okta"],
    optionalIntegrations: ["Slack", "Jira"],
    pricingTier: "Growth",
    monthlyPriceUsd: 69,
    tileIcon: "it-automation.svg",
  },
  {
    id: "legal-assistant",
    name: "Legal Assistant Agent",
    category: "Operations",
    description: "Reviews contracts and flags common risks or deviations from standard terms.",
    capabilities: ["Contract review", "Risk flagging", "Clause analysis"],
    requiredIntegrations: ["Docusign", "Notion"],
    optionalIntegrations: ["Slack"],
    pricingTier: "Scale",
    monthlyPriceUsd: 159,
    tileIcon: "legal-assistant.svg",
  },
  {
    id: "engineering-triage",
    name: "Engineering Triage Agent",
    category: "Engineering",
    description: "Analyzes incidents, clusters errors, and drafts fix recommendations.",
    capabilities: ["Log clustering", "Incident summarization", "Fix suggestions"],
    requiredIntegrations: ["GitHub", "Datadog"],
    optionalIntegrations: ["PagerDuty", "Slack"],
    pricingTier: "Scale",
    monthlyPriceUsd: 149,
    tileIcon: "engineering-triage.svg",
  },
  {
    id: "security-sentinel",
    name: "Security Sentinel Agent",
    category: "Engineering",
    description: "Monitors vulnerabilities and security threats across your infrastructure.",
    capabilities: ["Vulnerability scanning", "Threat detection", "Alert prioritization"],
    requiredIntegrations: ["Sentry", "GitHub"],
    optionalIntegrations: ["PagerDuty", "Slack"],
    pricingTier: "Scale",
    monthlyPriceUsd: 199,
    tileIcon: "security-sentinel.svg",
  },
  {
    id: "data-intelligence",
    name: "Data Intelligence Agent",
    category: "Engineering",
    description: "Enriches raw data with market insights and predictive analytics.",
    capabilities: ["Predictive analytics", "Market insights", "Data enrichment"],
    requiredIntegrations: ["Apollo", "PostgreSQL"],
    optionalIntegrations: ["BigQuery", "Slack"],
    pricingTier: "Growth",
    monthlyPriceUsd: 119,
    tileIcon: "data-intelligence.svg",
  },
  {
    id: "support-deflection",
    name: "Support Deflection Agent",
    category: "Support",
    description: "Handles Tier 1 requests, resolves known issues, and escalates edge cases.",
    capabilities: ["Intent classification", "KB grounded responses", "Escalation"],
    requiredIntegrations: ["Intercom", "Sanity"],
    optionalIntegrations: ["Slack"],
    pricingTier: "Growth",
    monthlyPriceUsd: 69,
    tileIcon: "support-deflection.svg",
  },
  {
    id: "customer-support",
    name: "Customer Support Agent",
    category: "Support",
    description: "Handles complex support requests and escalates edge cases to humans.",
    capabilities: ["Ticket resolution", "Issue classification", "Human escalation"],
    requiredIntegrations: ["Zendesk", "Intercom"],
    optionalIntegrations: ["Slack", "Jira"],
    pricingTier: "Growth",
    monthlyPriceUsd: 59,
    tileIcon: "customer-support.svg",
  },
  {
    id: "campaign-optimizer",
    name: "Campaign Optimizer Agent",
    category: "Marketing",
    description: "Monitors campaign performance and proposes budget/channel shifts.",
    capabilities: ["Performance monitoring", "Budget reallocation", "Audience insights"],
    requiredIntegrations: ["Google Ads"],
    optionalIntegrations: ["Posthog", "Slack"],
    pricingTier: "Growth",
    monthlyPriceUsd: 89,
    tileIcon: "campaign-optimizer.svg",
  },
  {
    id: "social-media-machine",
    name: "Social Media Machine",
    category: "Marketing",
    description: "Manages social presence, schedules posts, and engages with mentions.",
    capabilities: ["Post scheduling", "Auto-engagement", "Trend analysis"],
    requiredIntegrations: ["Buffer", "Twitter"],
    optionalIntegrations: ["Slack"],
    pricingTier: "Growth",
    monthlyPriceUsd: 59,
    tileIcon: "social-media-machine.svg",
  },
  {
    id: "seo-audit",
    name: "SEO Audit Agent",
    category: "Marketing",
    description: "Performs technical SEO audits and monitors keyword rankings.",
    capabilities: ["Technical audit", "Rank tracking", "Content optimization"],
    requiredIntegrations: ["Google Search Console"],
    optionalIntegrations: ["Slack"],
    pricingTier: "Starter",
    monthlyPriceUsd: 49,
    tileIcon: "seo-audit.svg",
  },
  {
    id: "reputation-manager",
    name: "Reputation Manager Agent",
    category: "Marketing",
    description: "Monitors brand mentions across the web and manages review responses.",
    capabilities: ["Mention monitoring", "Review response", "Sentiment analysis"],
    requiredIntegrations: ["Brave Search", "Trustpilot"],
    optionalIntegrations: ["Slack"],
    pricingTier: "Growth",
    monthlyPriceUsd: 79,
    tileIcon: "reputation-manager.svg",
  },
  {
    id: "content-generation",
    name: "Content Generation Agent",
    category: "Marketing",
    description: "Generates multi-channel content from a single project brief.",
    capabilities: ["Content drafting", "Multi-channel adaptation", "Style matching"],
    requiredIntegrations: ["Sanity", "OpenAI"],
    optionalIntegrations: ["Slack", "Notion"],
    pricingTier: "Growth",
    monthlyPriceUsd: 99,
    tileIcon: "content-generation.svg",
  },
  {
    id: "devrel-outreach",
    name: "DevRel Outreach Agent",
    category: "Marketing",
    description: "Engages with developers in the ecosystem and tracks community growth.",
    capabilities: ["Community engagement", "GitHub monitoring", "Growth tracking"],
    requiredIntegrations: ["GitHub", "Discord"],
    optionalIntegrations: ["Slack", "Orbit"],
    pricingTier: "Growth",
    monthlyPriceUsd: 89,
    tileIcon: "devrel-outreach.svg",
  },
  {
    id: "market-intelligence",
    name: "Market Intelligence Agent",
    category: "Marketing",
    description: "Tracks competitors and market trends to inform strategic decisions.",
    capabilities: ["Competitor tracking", "Trend analysis", "Strategic insights"],
    requiredIntegrations: ["Brave Search", "Notion"],
    optionalIntegrations: ["Slack"],
    pricingTier: "Growth",
    monthlyPriceUsd: 109,
    tileIcon: "market-intelligence.svg",
  },
  {
    id: "customer-onboarding",
    name: "Customer Onboarding Agent",
    category: "Success",
    description: "Automates welcome sequences and initial product setup for new users.",
    capabilities: ["Welcome sequences", "Setup automation", "User training"],
    requiredIntegrations: ["Intercom", "HubSpot"],
    optionalIntegrations: ["Slack", "Notion"],
    pricingTier: "Growth",
    monthlyPriceUsd: 79,
    tileIcon: "customer-onboarding.svg",
  },
  {
    id: "finance-automation",
    name: "Finance Automation Agent",
    category: "Operations",
    description: "Automates invoicing, billing, and reconciliation across your finance stack.",
    capabilities: ["Invoice processing", "Billing automation", "Reconciliation"],
    requiredIntegrations: ["Stripe", "PostgreSQL"],
    optionalIntegrations: ["Slack", "Quickbooks"],
    pricingTier: "Scale",
    monthlyPriceUsd: 149,
    tileIcon: "finance-automation.svg",
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
