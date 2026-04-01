/**
 * Step handlers — one function per StepKind.
 *
 * Each handler receives the step definition and the current execution context
 * (all outputs accumulated so far, plus config values), and returns the
 * output produced by this step.
 *
 * LLM calls are stubbed — replace with real provider calls once the
 * AI/ML Engineer integrates the LLM layer (see ALT-30 / ALT-29).
 */

import { WorkflowStep } from "../types/workflow";

export type StepContext = Record<string, unknown>;

export interface StepHandlerResult {
  output: Record<string, unknown>;
  /** Set to true by a condition step when the false-branch steps should be skipped */
  skip?: boolean;
}

/** Interpolate {{key}} placeholders in a template string using context values */
function interpolate(template: string, ctx: StepContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = ctx[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

export async function handleTrigger(
  step: WorkflowStep,
  ctx: StepContext
): Promise<StepHandlerResult> {
  // The trigger step passes its outputKeys straight through from the run input.
  const output: Record<string, unknown> = {};
  for (const key of step.outputKeys) {
    if (key in ctx) output[key] = ctx[key];
  }
  return { output };
}

// ---------------------------------------------------------------------------
// LLM  (stub — replace with real provider call)
// ---------------------------------------------------------------------------

export async function handleLlm(
  step: WorkflowStep,
  ctx: StepContext
): Promise<StepHandlerResult> {
  if (!step.promptTemplate) {
    throw new Error(`LLM step "${step.id}" is missing a promptTemplate`);
  }

  const renderedPrompt = interpolate(step.promptTemplate, ctx);

  // Stub: return a synthetic object keyed by outputKeys.
  // Real implementation: call Anthropic / OpenAI and parse the JSON response.
  const output: Record<string, unknown> = {
    _stub: true,
    _prompt: renderedPrompt,
  };
  for (const key of step.outputKeys) {
    output[key] = `[llm:${key}]`;
  }

  return { output };
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

export async function handleTransform(
  step: WorkflowStep,
  ctx: StepContext
): Promise<StepHandlerResult> {
  const action = step.action ?? "";

  // Built-in transform actions
  if (action === "enrichment.lookup") {
    // Stub: real implementation calls a data enrichment API
    const output: Record<string, unknown> = {
      employees: 250,
      revenue: "10M–50M",
      industry: "Software",
      techStack: ["React", "Node.js", "PostgreSQL"],
      linkedinUrl: `https://linkedin.com/company/${String(ctx["company"] ?? "unknown").toLowerCase().replace(/\s+/g, "-")}`,
      _stub: true,
    };
    return { output };
  }

  if (action === "content.applyBrandTemplate") {
    const blogPost = String(ctx["blogPost"] ?? "");
    const output: Record<string, unknown> = {
      formattedPost: `<!-- brand header -->\n${blogPost}\n<!-- brand footer -->`,
    };
    return { output };
  }

  // Passthrough: copy inputKeys to outputKeys as-is
  const output: Record<string, unknown> = {};
  for (const key of step.outputKeys) {
    if (key in ctx) output[key] = ctx[key];
  }
  return { output };
}

// ---------------------------------------------------------------------------
// Condition
// ---------------------------------------------------------------------------

export async function handleCondition(
  step: WorkflowStep,
  ctx: StepContext
): Promise<StepHandlerResult> {
  if (!step.condition) {
    return { output: { _conditionResult: true } };
  }

  // Safe expression evaluation: allow simple comparisons and logical ops.
  // For production, replace with a sandboxed evaluator (e.g. vm2, expr-eval).
  let result = false;
  try {
    // Build a tiny scope from the context, then evaluate.
    const keys = Object.keys(ctx);
    const vals = Object.values(ctx);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, `return (${step.condition});`);
    result = Boolean(fn(...vals));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Condition step "${step.id}" evaluation failed: ${msg}\n` +
        `Expression: ${step.condition}`
    );
  }

  // The first outputKey receives the boolean result.
  const output: Record<string, unknown> = {};
  if (step.outputKeys[0]) output[step.outputKeys[0]] = result;

  return { output, skip: !result };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function handleAction(
  step: WorkflowStep,
  ctx: StepContext
): Promise<StepHandlerResult> {
  const action = step.action ?? "";

  if (action === "email.send") {
    const output: Record<string, unknown> = { sent: true, _stub: true };
    return { output };
  }

  if (action === "support.sendOrEscalate") {
    const shouldAutoRespond = Boolean(ctx["shouldAutoRespond"]);
    const output: Record<string, unknown> = {
      resolution: shouldAutoRespond ? "auto_responded" : "escalated",
      escalated: !shouldAutoRespond,
      _stub: true,
    };
    return { output };
  }

  if (action === "crm.upsertLead") {
    const output: Record<string, unknown> = {
      crmId: `lead_${Math.floor(Math.random() * 10000)}`,
      crmUrl: "https://crm.example.com/leads/stub",
      _stub: true,
    };
    return { output };
  }

  if (action === "content.queue") {
    const output: Record<string, unknown> = {
      queueId: `cq-${String(Math.floor(Math.random() * 99999)).padStart(5, "0")}`,
      _stub: true,
    };
    return { output };
  }

  // Unknown action — pass through outputKeys from context
  const output: Record<string, unknown> = { _stub: true, _action: action };
  for (const key of step.outputKeys) {
    if (key in ctx) output[key] = ctx[key];
  }
  return { output };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export async function handleOutput(
  step: WorkflowStep,
  ctx: StepContext
): Promise<StepHandlerResult> {
  const action = step.action ?? "";

  if (action === "events.emit") {
    const output: Record<string, unknown> = {
      event: { type: "workflow.completed", stepId: step.id },
    };
    return { output };
  }

  // Default: collect all inputKeys into the output
  const output: Record<string, unknown> = {};
  for (const key of step.inputKeys) {
    if (key in ctx) output[key] = ctx[key];
  }
  return { output };
}
