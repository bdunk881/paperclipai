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
import { getImportedTemplate, listImportedTemplates } from "./importedTemplateStore";

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

export function listTemplates(): WorkflowTemplate[] {
  return [...WORKFLOW_TEMPLATES, ...listImportedTemplates()];
}

/** Returns templates filtered by category */
export function getTemplatesByCategory(
  category: WorkflowTemplate["category"]
): WorkflowTemplate[] {
  return listTemplates().filter((t) => t.category === category);
}

/** Returns a template by ID, throwing if not found */
export function getTemplate(id: string): WorkflowTemplate {
  const tpl = TEMPLATE_MAP[id] ?? getImportedTemplate(id);
  if (!tpl) {
    throw new Error(`Workflow template not found: ${id}`);
  }
  return tpl;
}
