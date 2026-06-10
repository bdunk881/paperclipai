/**
 * Error trigger step (HEL-679, Phase 1).
 *
 * The head of an error-handler workflow. HEL-772 fires a designated error
 * workflow with `input.errorTrigger = { failedRunId, failedStepId, templateId,
 * templateName, error }`; this trigger hoists those fields to the top of the run
 * context so downstream steps can reference `{{errorMessage}}`, `{{failedRunId}}`,
 * etc. With no payload (e.g. a manual run of the workflow) it surfaces safe
 * nulls, so the trigger still validates as a workflow head.
 */

export function handleErrorTrigger(context: Record<string, unknown>): Record<string, unknown> {
  const raw = context["errorTrigger"];
  const errorTrigger: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  return {
    errorTrigger,
    failedRunId: errorTrigger["failedRunId"] ?? null,
    failedStepId: errorTrigger["failedStepId"] ?? null,
    failedTemplateId: errorTrigger["templateId"] ?? null,
    failedTemplateName: errorTrigger["templateName"] ?? null,
    errorMessage: errorTrigger["error"] ?? null,
  };
}
