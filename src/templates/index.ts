/**
 * Template registry — maps template IDs to their definitions.
 * The dashboard and runtime both consume this registry.
 */

import { WorkflowTemplate } from "../types/workflow";
import { customerSupportBot } from "./customer-support-bot";
import { leadEnrichment } from "./lead-enrichment";
import { contentGenerator } from "./content-generator";
import {
  ADDITIONAL_WORKFLOW_TEMPLATES,
  crmPipelineTemplate,
  customerOnboardingTemplate,
  dataSyncTemplate,
  emailCampaignTemplate,
  githubIssueTriageTemplate,
  invoiceProcessingTemplate,
  leadScoringTemplate,
  slackNotificationTemplate,
  socialMonitoringTemplate,
  supportTicketRoutingTemplate,
} from "./additional-templates";
import {
  getImportedTemplate,
  getImportedTemplateAsync,
  listImportedTemplatesAsync,
} from "./importedTemplateStore";

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  customerSupportBot,
  leadEnrichment,
  contentGenerator,
  ...ADDITIONAL_WORKFLOW_TEMPLATES,
];

export const TEMPLATE_MAP: Record<string, WorkflowTemplate> = Object.fromEntries(
  WORKFLOW_TEMPLATES.map((t) => [t.id, t])
);

export {
  contentGenerator,
  crmPipelineTemplate,
  customerOnboardingTemplate,
  customerSupportBot,
  dataSyncTemplate,
  emailCampaignTemplate,
  githubIssueTriageTemplate,
  invoiceProcessingTemplate,
  leadEnrichment,
  leadScoringTemplate,
  slackNotificationTemplate,
  socialMonitoringTemplate,
  supportTicketRoutingTemplate,
};

// HEL-520: imported-template reads are workspace-scoped and Postgres-backed,
// so getTemplate/listTemplates are async. Built-in seeds resolve globally and
// synchronously from TEMPLATE_MAP; imported templates resolve only when visible
// to `workspaceId`. Omitting `workspaceId` (internal re-resolution of an
// already-owned run's DAG) sees every imported template — those paths are not a
// cross-tenant enumeration vector.

export async function listTemplates(workspaceId?: string | null): Promise<WorkflowTemplate[]> {
  return [...WORKFLOW_TEMPLATES, ...(await listImportedTemplatesAsync(workspaceId))];
}

/** Returns templates filtered by category */
export async function getTemplatesByCategory(
  category: WorkflowTemplate["category"],
  workspaceId?: string | null,
): Promise<WorkflowTemplate[]> {
  return (await listTemplates(workspaceId)).filter((t) => t.category === category);
}

/** Returns a template by ID, throwing if not found. */
export async function getTemplate(id: string, workspaceId?: string | null): Promise<WorkflowTemplate> {
  const tpl = TEMPLATE_MAP[id] ?? (await getImportedTemplateAsync(id, workspaceId));
  if (!tpl) {
    throw new Error(`Workflow template not found: ${id}`);
  }
  return tpl;
}

/**
 * Synchronous, cache-only resolution (seeds + the warmed imported-template
 * cache). For miss-tolerant synchronous contexts that already fall back to an
 * inline `run.workflowDag` snapshot (e.g. the observability records builder),
 * where awaiting a DB read inside a hot synchronous map would be invasive.
 */
export function getTemplateCached(
  id: string,
  workspaceId?: string | null,
): WorkflowTemplate | undefined {
  return TEMPLATE_MAP[id] ?? getImportedTemplate(id, workspaceId);
}
