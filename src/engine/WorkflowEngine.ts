/**
 * Core workflow execution engine for AutoFlow.
 *
 * Executes a WorkflowTemplate step-by-step, tracking state in the run store.
 * Each step type has a dedicated executor. LLM steps call the pluggable
 * llmProvider — wire in a real provider via setLlmProvider() (see TODO below).
 */

import { v4 as uuidv4 } from "uuid";
import {
  WorkflowTemplate,
  WorkflowRun,
  WorkflowStep,
  StepResult,
} from "../types/workflow";
import { runStore } from "./runStore";
import { handleLlm } from "./stepHandlers";

// ---------------------------------------------------------------------------
// LLM provider interface — injectable for tests; production uses llmConfigStore
// ---------------------------------------------------------------------------

type LlmProvider = (prompt: string) => Promise<string>;

let _llmProvider: LlmProvider = async (prompt: string) => {
  // Default stub — only used if setLlmProvider has not been called.
  const lower = prompt.toLowerCase();
  if (lower.includes("classify") || lower.includes("intent")) {
    return JSON.stringify({ intent: "general", sentiment: "neutral", summary: "Customer needs help with their account." });
  }
  if (lower.includes("lead") || lower.includes("score")) {
    return JSON.stringify({ companySize: "50-200", industry: "SaaS", leadScore: 72, enriched: true });
  }
  if (lower.includes("draft") || lower.includes("content") || lower.includes("blog")) {
    return "Thank you for reaching out. We've received your request and will follow up shortly.";
  }
  return JSON.stringify({ result: "processed", ok: true });
};

// Tracks whether a custom provider has been injected (e.g. in tests).
// When true, _llmProvider is used. When false, llmConfigStore is used.
let _isCustomProvider = false;

export function setLlmProvider(provider: LlmProvider): void {
  _llmProvider = provider;
  _isCustomProvider = true;
}

// ---------------------------------------------------------------------------
// Action registry — maps action identifiers to handler functions
// ---------------------------------------------------------------------------

type ActionHandler = (
  inputs: Record<string, unknown>,
  config: Record<string, unknown>
) => Promise<Record<string, unknown>>;

const actionRegistry = new Map<string, ActionHandler>();

// Built-in actions
actionRegistry.set("support.sendOrEscalate", async (inputs) => {
  const shouldAutoRespond = Boolean(inputs["shouldAutoRespond"]);
  return {
    resolution: shouldAutoRespond ? "auto_responded" : "escalated",
    escalated: !shouldAutoRespond,
  };
});

actionRegistry.set("events.emit", async (inputs) => {
  const ticketId = inputs["ticketId"] ?? inputs["leadId"] ?? "unknown";
  const intent = inputs["intent"] ?? inputs["action"] ?? "processed";
  return {
    event: { type: `${intent}.resolved`, id: ticketId, timestamp: new Date().toISOString() },
  };
});

actionRegistry.set("crm.upsertLead", async (inputs) => {
  return { crmId: `CRM-${uuidv4().slice(0, 8).toUpperCase()}`, upserted: true, lead: inputs };
});

actionRegistry.set("content.publish", async (inputs) => {
  return { published: true, contentId: `CONT-${uuidv4().slice(0, 8).toUpperCase()}`, content: inputs["draft"] };
});

export function registerAction(name: string, handler: ActionHandler): void {
  actionRegistry.set(name, handler);
}

// ---------------------------------------------------------------------------
// Prompt interpolation
// ---------------------------------------------------------------------------

function interpolate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = context[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

// ---------------------------------------------------------------------------
// Condition evaluator — uses Function constructor with scoped variables.
// Only template-defined condition strings are evaluated; no user input reaches here.
// ---------------------------------------------------------------------------

function evalCondition(expression: string, context: Record<string, unknown>): boolean {
  try {
    const keys = Object.keys(context);
    const values = Object.values(context);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(...keys, `return Boolean(${expression});`);
    return fn(...values);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Step executors
// ---------------------------------------------------------------------------

async function executeTrigger(
  step: WorkflowStep,
  context: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // The trigger step passes through the run input, extracting declared output keys.
  const out: Record<string, unknown> = {};
  for (const key of step.outputKeys) {
    if (key in context) out[key] = context[key];
  }
  return out;
}

async function executeLlm(
  step: WorkflowStep,
  context: Record<string, unknown>,
  userId?: string
): Promise<Record<string, unknown>> {
  if (_isCustomProvider) {
    // Test/legacy path: use the injected string-returning provider
    const rawPrompt = step.promptTemplate ?? "";
    const prompt = interpolate(rawPrompt, context);
    const rawOutput = await _llmProvider(prompt);

    try {
      const parsed = JSON.parse(rawOutput) as unknown;
      if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
    } catch {
      // Not JSON — treat as a text value mapped to the first output key
    }

    const firstKey = step.outputKeys[0] ?? "output";
    return { [firstKey]: rawOutput };
  }

  // Production path: resolve config from llmConfigStore via handleLlm
  const result = await handleLlm(step, context, userId ?? "");
  return result.output;
}

async function executeTransform(
  step: WorkflowStep,
  context: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // Pass through input keys as output keys (identity transform for MVP).
  // Extend with a transform expression field to do field mapping, math, etc.
  const out: Record<string, unknown> = {};
  for (const key of step.outputKeys) {
    if (key in context) out[key] = context[key];
  }
  return out;
}

async function executeCondition(
  step: WorkflowStep,
  context: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const result = step.condition ? evalCondition(step.condition, context) : false;
  const key = step.outputKeys[0] ?? "conditionResult";
  return { [key]: result };
}

async function executeAction(
  step: WorkflowStep,
  context: Record<string, unknown>,
  config: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const actionName = step.action;
  if (!actionName) return {};

  const handler = actionRegistry.get(actionName);
  if (!handler) {
    // Unknown action: return a stub with output keys set to null
    const out: Record<string, unknown> = {};
    for (const key of step.outputKeys) out[key] = null;
    return out;
  }

  const inputs: Record<string, unknown> = {};
  for (const key of step.inputKeys) {
    inputs[key] = context[key] ?? config[key];
  }
  return handler(inputs, config);
}

async function executeOutput(
  step: WorkflowStep,
  context: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // Collect declared input keys into the output record
  const out: Record<string, unknown> = {};
  for (const key of step.inputKeys) {
    if (key in context) out[key] = context[key];
  }
  return { ...out, completedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

export class WorkflowEngine {
  /**
   * Creates a new run record and starts execution asynchronously.
   * Returns immediately with the pending run — callers can poll GET /api/runs/:id.
   */
  startRun(
    template: WorkflowTemplate,
    input: Record<string, unknown>,
    config?: Record<string, unknown>,
    userId?: string
  ): WorkflowRun {
    const runConfig = { ...this._buildDefaultConfig(template), ...(config ?? {}) };

    const run: WorkflowRun = runStore.create({
      id: uuidv4(),
      templateId: template.id,
      templateName: template.name,
      status: "pending",
      startedAt: new Date().toISOString(),
      input,
      stepResults: [],
    });

    // Execute asynchronously so the HTTP response returns immediately
    this._executeRun(run.id, template, input, runConfig, userId).catch((err) => {
      runStore.update(run.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: String(err),
      });
    });

    return run;
  }

  private _buildDefaultConfig(template: WorkflowTemplate): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    for (const field of template.configFields) {
      if (field.defaultValue !== undefined) config[field.key] = field.defaultValue;
    }
    return config;
  }

  private async _executeRun(
    runId: string,
    template: WorkflowTemplate,
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    userId?: string
  ): Promise<void> {
    runStore.update(runId, { status: "running" });

    // The execution context accumulates outputs from all steps + initial input + config
    const context: Record<string, unknown> = { ...config, ...input };
    const stepResults: StepResult[] = [];

    for (const step of template.steps) {
      const start = Date.now();
      let stepOutput: Record<string, unknown> = {};
      let stepError: string | undefined;
      let stepStatus: StepResult["status"] = "success";

      try {
        switch (step.kind) {
          case "trigger":
            stepOutput = await executeTrigger(step, context);
            break;
          case "llm":
            stepOutput = await executeLlm(step, context, userId);
            break;
          case "transform":
            stepOutput = await executeTransform(step, context);
            break;
          case "condition":
            stepOutput = await executeCondition(step, context);
            break;
          case "action":
            stepOutput = await executeAction(step, context, config);
            break;
          case "output":
            stepOutput = await executeOutput(step, context);
            break;
          default:
            stepOutput = {};
        }
      } catch (err) {
        stepStatus = "failure";
        stepError = String(err);
      }

      // Merge step outputs into context for downstream steps
      Object.assign(context, stepOutput);

      const result: StepResult = {
        stepId: step.id,
        stepName: step.name,
        status: stepStatus,
        output: stepOutput,
        durationMs: Date.now() - start,
        ...(stepError ? { error: stepError } : {}),
      };

      stepResults.push(result);

      // Update run with latest step results so callers can see incremental progress
      runStore.update(runId, { stepResults: [...stepResults] });

      // If a step fails, abort the run
      if (stepStatus === "failure") {
        runStore.update(runId, {
          status: "failed",
          completedAt: new Date().toISOString(),
          error: stepError,
          stepResults,
        });
        return;
      }
    }

    // Collect final output from context (keys produced by the last step)
    const lastStep = template.steps[template.steps.length - 1];
    const output: Record<string, unknown> = {};
    if (lastStep) {
      for (const key of [...lastStep.outputKeys, ...lastStep.inputKeys]) {
        if (key in context) output[key] = context[key];
      }
    }

    runStore.update(runId, {
      status: "completed",
      completedAt: new Date().toISOString(),
      output,
      stepResults,
    });
  }
}

export const workflowEngine = new WorkflowEngine();
