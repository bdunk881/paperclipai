/**
 * Template registry — maps template IDs to their definitions.
 * The dashboard and runtime both consume this registry.
 */

import { WorkflowTemplate } from "../types/workflow";
import { customerSupportBot } from "./customer-support-bot";
import { leadEnrichment } from "./lead-enrichment";
import { contentGenerator } from "./content-generator";

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  customerSupportBot,
  leadEnrichment,
  contentGenerator,
];

export const TEMPLATE_MAP: Record<string, WorkflowTemplate> = Object.fromEntries(
  WORKFLOW_TEMPLATES.map((t) => [t.id, t])
);

export { customerSupportBot, leadEnrichment, contentGenerator };

/** Returns templates filtered by category */
export function getTemplatesByCategory(
  category: WorkflowTemplate["category"]
): WorkflowTemplate[] {
  return WORKFLOW_TEMPLATES.filter((t) => t.category === category);
}

/** Returns a template by ID, throwing if not found */
export function getTemplate(id: string): WorkflowTemplate {
  const tpl = TEMPLATE_MAP[id];
  if (!tpl) {
    throw new Error(`Workflow template not found: ${id}`);
  }
  return tpl;
}
