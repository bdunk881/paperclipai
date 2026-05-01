import { getApiBasePath } from "./baseUrl";

const BASE = getApiBasePath();

export interface AgentCatalogTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  defaultModel?: string;
  defaultInstructions: string;
  skills: string[];
  suggestedBudgetMonthlyUsd: number;
  tileIcon?: string;
  pricingTier?: string;
}

interface RoleTemplateResponse {
  roleTemplates: Array<{
    id: string;
    name: string;
    description: string;
    defaultModel?: string;
    defaultInstructions: string;
    defaultSkills: string[];
  }>;
}

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

function categorizeTemplate(template: {
  id: string;
  name: string;
  description: string;
}): string {
  const haystack = `${template.id} ${template.name} ${template.description}`.toLowerCase();
  if (/(sales|revenue|cro|account)/.test(haystack)) return "Sales";
  if (/(support|success)/.test(haystack)) return "Support";
  if (/(marketing|content|brand|devrel|cmo)/.test(haystack)) return "Marketing";
  if (/(engineer|developer|cto|security|qa|devops|integration)/.test(haystack)) return "Engineering";
  return "Operations";
}

function suggestedBudgetForTemplate(defaultModel?: string): number {
  if (!defaultModel) return 0;
  if (defaultModel.includes("mini")) return 50;
  return 100;
}

function mapTemplate(template: RoleTemplateResponse["roleTemplates"][number]): AgentCatalogTemplate {
  return {
    id: template.id,
    name: template.name,
    category: categorizeTemplate(template),
    description: template.description,
    defaultModel: template.defaultModel,
    defaultInstructions: template.defaultInstructions,
    skills: [...template.defaultSkills].sort(),
    suggestedBudgetMonthlyUsd: suggestedBudgetForTemplate(template.defaultModel),
  };
}

export async function listAgentCatalogTemplates(accessToken: string): Promise<AgentCatalogTemplate[]> {
  const response = await fetch(`${BASE}/companies/role-templates`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch agent catalog: ${response.status}`);
  }
  const payload = (await response.json()) as RoleTemplateResponse;
  return payload.roleTemplates.map(mapTemplate);
}

export async function getAgentCatalogTemplate(
  templateId: string,
  accessToken: string
): Promise<AgentCatalogTemplate | null> {
  const templates = await listAgentCatalogTemplates(accessToken);
  return templates.find((template) => template.id === templateId) ?? null;
}
