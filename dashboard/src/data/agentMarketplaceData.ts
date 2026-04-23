export type AgentCategory = 
  | "AI/ML" 
  | "DevOps" 
  | "Security" 
  | "Data" 
  | "Content" 
  | "Marketing" 
  | "Sales" 
  | "Operations" 
  | "Engineering" 
  | "Support";
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
  // AI/ML
  {
    id: "ai-tools-pipeline",
    name: "AI Tools Pipeline",
    category: "AI/ML",
    description: "Orchestrates 150+ AI models for image generation, video creation, and search automation.",
    capabilities: ["Multi-model inference", "Image/Video generation", "Web search grounding"],
    requiredIntegrations: ["inference.sh"],
    optionalIntegrations: ["OpenRouter", "Tavily"],
    pricingTier: "Scale",
    monthlyPriceUsd: 199,
  },
  {
    id: "azure-ai-specialist",
    name: "Azure AI Specialist",
    category: "AI/ML",
    description: "Implements enterprise-grade AI Search, Speech-to-Text, and OpenAI integration via Azure.",
    capabilities: ["Vector search", "OCR & Transcription", "LLM integration"],
    requiredIntegrations: ["Azure AI"],
    optionalIntegrations: ["GitHub", "Slack"],
    pricingTier: "Growth",
    monthlyPriceUsd: 129,
  },
  {
    id: "ml-ops-engineer",
    name: "ML Ops Engineer",
    category: "AI/ML",
    description: "Designs and monitors scalable machine learning pipelines for production serving and optimization.",
    capabilities: ["Model deployment", "Inference optimization", "Pipeline monitoring"],
    requiredIntegrations: ["GitHub", "Cloud Infrastructure"],
    optionalIntegrations: ["PagerDuty"],
    pricingTier: "Scale",
    monthlyPriceUsd: 249,
  },
  // DevOps
  {
    id: "azure-infra-lead",
    name: "Azure Infrastructure Lead",
    category: "DevOps",
    description: "Provisions and manages production-ready AKS clusters and Azure DevOps resources via CLI.",
    capabilities: ["AKS configuration", "DevOps CLI management", "Infrastructure-as-Code"],
    requiredIntegrations: ["Azure DevOps"],
    optionalIntegrations: ["Terraform"],
    pricingTier: "Growth",
    monthlyPriceUsd: 149,
  },
  {
    id: "vercel-deploy-agent",
    name: "Vercel Deployment Agent",
    category: "DevOps",
    description: "Automates Next.js deployments, preview environments, and performance monitoring on Vercel.",
    capabilities: ["Automated deployment", "Preview generation", "Performance auditing"],
    requiredIntegrations: ["Vercel"],
    optionalIntegrations: ["GitHub", "Slack"],
    pricingTier: "Starter",
    monthlyPriceUsd: 49,
  },
  {
    id: "cloudflare-manager",
    name: "Cloudflare Platform Manager",
    category: "DevOps",
    description: "Manages global edge infrastructure including Workers, Pages, storage, and WAF security.",
    capabilities: ["Worker orchestration", "Edge storage management", "WAF configuration"],
    requiredIntegrations: ["Cloudflare"],
    optionalIntegrations: ["Terraform", "Pulumi"],
    pricingTier: "Growth",
    monthlyPriceUsd: 89,
  },
  // Security
  {
    id: "secrets-officer",
    name: "Secrets Security Officer",
    category: "Security",
    description: "Implements secure vaulting, rotation, and management of sensitive credentials across CI/CD.",
    capabilities: ["Secrets rotation", "Vault management", "Credential auditing"],
    requiredIntegrations: ["HashiCorp Vault"],
    optionalIntegrations: ["AWS Secrets Manager", "GitHub"],
    pricingTier: "Scale",
    monthlyPriceUsd: 179,
  },
  {
    id: "security-audit-agent",
    name: "Security Audit Agent",
    category: "Security",
    description: "Conducts automated security reviews for authentication flows and sensitive API endpoints.",
    capabilities: ["Checklist analysis", "Vulnerability scanning", "Compliance auditing"],
    requiredIntegrations: ["GitHub"],
    optionalIntegrations: ["Stripe", "Slack"],
    pricingTier: "Growth",
    monthlyPriceUsd: 119,
  },
  // Data
  {
    id: "knowledge-capture",
    name: "Knowledge Capture Agent",
    category: "Data",
    description: "Synthesizes team discussions and chat history into structured, searchable Notion wikis.",
    capabilities: ["Meeting synthesis", "Decision logging", "Wiki organization"],
    requiredIntegrations: ["Notion"],
    optionalIntegrations: ["Slack", "Google Meet"],
    pricingTier: "Starter",
    monthlyPriceUsd: 59,
  },
  {
    id: "research-documentation",
    name: "Research Documentation Pro",
    category: "Data",
    description: "Aggregates and synthesizes cross-functional research into comprehensive, cited reports.",
    capabilities: ["Data aggregation", "Report synthesis", "Citation management"],
    requiredIntegrations: ["Notion"],
    optionalIntegrations: ["Exa Search", "Slack"],
    pricingTier: "Growth",
    monthlyPriceUsd: 99,
  },
  // Content
  {
    id: "content-production-lead",
    name: "Content Production Lead",
    category: "Content",
    description: "Orchestrates the weekly content cycle from ideation to production across developer channels.",
    capabilities: ["Calendar management", "Production tracking", "Channel coordination"],
    requiredIntegrations: ["Notion"],
    optionalIntegrations: ["Twitter", "Slack"],
    pricingTier: "Growth",
    monthlyPriceUsd: 89,
  },
  {
    id: "marketing-copywriter",
    name: "Marketing Copywriter",
    category: "Content",
    description: "Crafts high-converting marketing copy for landing pages, headlines, and calls-to-action.",
    capabilities: ["Copy generation", "Headline A/B testing", "CTA optimization"],
    requiredIntegrations: ["Notion"],
    optionalIntegrations: ["Figma"],
    pricingTier: "Starter",
    monthlyPriceUsd: 69,
  },
  // Marketing
  {
    id: "campaign-architecture-pro",
    name: "Campaign Architecture Pro",
    category: "Marketing",
    description: "Plans and restructures website navigation and internal linking to optimize for conversion.",
    capabilities: ["Site mapping", "Navigation design", "Linking strategy"],
    requiredIntegrations: ["Figma"],
    optionalIntegrations: ["Google Analytics"],
    pricingTier: "Growth",
    monthlyPriceUsd: 109,
  },
  {
    id: "twitter-growth-automator",
    name: "Twitter Growth Automator",
    category: "Marketing",
    description: "Automates high-engagement social media posting and audience growth via X/Twitter.",
    capabilities: ["Post scheduling", "Engagement automation", "Audience analytics"],
    requiredIntegrations: ["Twitter API"],
    optionalIntegrations: ["inference.sh"],
    pricingTier: "Starter",
    monthlyPriceUsd: 49,
  },
  // Sales
  {
    id: "crm-ops-lead",
    name: "CRM Operations Lead",
    category: "Sales",
    description: "Manages Attio CRM operations for lead enrichment, contact management, and deal tracking.",
    capabilities: ["Record enrichment", "Contact management", "Deal tracking"],
    requiredIntegrations: ["Attio"],
    optionalIntegrations: ["Apollo", "Slack"],
    pricingTier: "Growth",
    monthlyPriceUsd: 129,
  },
  {
    id: "pipeline-health-analyst",
    name: "Pipeline Health Analyst",
    category: "Sales",
    description: "Executes daily revenue operating routines for pipeline monitoring and ICP refinement.",
    capabilities: ["Pipeline monitoring", "ICP refinement", "Health reporting"],
    requiredIntegrations: ["CRM"],
    optionalIntegrations: ["Apollo"],
    pricingTier: "Scale",
    monthlyPriceUsd: 159,
  },
  // Operations
  {
    id: "agent-routine-controller",
    name: "Agent Routine Controller",
    category: "Operations",
    description: "Audits and optimizes heartbeat routines for all AI agents to ensure peak productivity.",
    capabilities: ["Routine auditing", "Frequency optimization", "Spend management"],
    requiredIntegrations: ["Paperclip AI"],
    optionalIntegrations: ["Slack"],
    pricingTier: "Scale",
    monthlyPriceUsd: 149,
  },
  {
    id: "ideation-engine",
    name: "Business Ideation Engine",
    category: "Operations",
    description: "Governs the weekly business idea pipeline from market signal sourcing to PRD drafting.",
    capabilities: ["Signal sourcing", "Feasibility scoring", "PRD drafting"],
    requiredIntegrations: ["GitHub"],
    optionalIntegrations: ["Notion", "Slack"],
    pricingTier: "Growth",
    monthlyPriceUsd: 99,
  },
  // Engineering
  {
    id: "browser-automation-lead",
    name: "Browser Automation Lead",
    category: "Engineering",
    description: "Executes complex browser interactions for automated testing and data extraction tasks.",
    capabilities: ["Web testing", "Data extraction", "Form automation"],
    requiredIntegrations: ["Playwright"],
    optionalIntegrations: ["GitHub"],
    pricingTier: "Growth",
    monthlyPriceUsd: 119,
  },
  {
    id: "ui-ux-design-specialist",
    name: "UI/UX Design Specialist",
    category: "Engineering",
    description: "Implements production-grade frontend interfaces with a focus on accessibility and design.",
    capabilities: ["Component building", "Accessibility auditing", "Style implementation"],
    requiredIntegrations: ["React", "Tailwind"],
    optionalIntegrations: ["shadcn/ui", "Figma"],
    pricingTier: "Growth",
    monthlyPriceUsd: 139,
  },
  {
    id: "react-performance-auditor",
    name: "React Performance Auditor",
    category: "Engineering",
    description: "Refactors React/Next.js code following performance optimization best practices.",
    capabilities: ["Bundle optimization", "Hook refactoring", "Server component audit"],
    requiredIntegrations: ["Vercel"],
    optionalIntegrations: ["GitHub"],
    pricingTier: "Scale",
    monthlyPriceUsd: 169,
  },
  // Support
  {
    id: "devrel-routines-lead",
    name: "DevRel Routines Lead",
    category: "Support",
    description: "Manages community feedback, integration content, and developer experience readiness.",
    capabilities: ["Feedback sweeping", "Docs review", "Community engagement"],
    requiredIntegrations: ["Discord", "GitHub"],
    optionalIntegrations: ["Notion", "Slack"],
    pricingTier: "Growth",
    monthlyPriceUsd: 109,
  },
  {
    id: "tier-1-deflection",
    name: "Tier 1 Deflection Agent",
    category: "Support",
    description: "Resolves common customer issues using knowledge base grounding and guided workflows.",
    capabilities: ["Intent classification", "Knowledge base grounding", "Guided resolution"],
    requiredIntegrations: ["Helpdesk", "Notion"],
    optionalIntegrations: ["Slack"],
    pricingTier: "Starter",
    monthlyPriceUsd: 69,
  },
];

const DEFAULT_DEPLOYMENTS: DeployedAgent[] = [
  {
    id: "dep_sales_001",
    templateId: "crm-ops-lead",
    templateName: "CRM Operations Lead",
    name: "Attio Revenue Desk",
    status: "running",
    permissions: ["read", "execute"],
    integrations: ["Attio", "Apollo", "Slack"],
    deployedAt: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
    lastActiveAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
    tokenUsage24h: 19840,
  },
  {
    id: "dep_ops_001",
    templateId: "agent-routine-controller",
    templateName: "Agent Routine Controller",
    name: "Heartbeat Command Center",
    status: "paused",
    permissions: ["read", "write"],
    integrations: ["Paperclip AI", "Slack"],
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
