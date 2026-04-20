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
  AgentSlotResult,
  WorkflowRetryPolicy,
} from "../types/workflow";
import { runStore } from "./runStore";
import { approvalStore } from "./approvalStore";
import { handleLlm, handleMcp, handleFileTrigger, handleAgent } from "./stepHandlers";
import { memoryStore } from "./memoryStore";
import { LlmCostLog } from "./llmRouter";

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

type StepPhase = NonNullable<StepResult["phase"]>;

interface StepExecutionState {
  output: Record<string, unknown>;
  status: StepResult["status"];
  error?: string;
  agentSlotResults?: AgentSlotResult[];
  costLog?: LlmCostLog;
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
): Promise<{ output: Record<string, unknown>; costLog?: LlmCostLog }> {
  if (_isCustomProvider) {
    // Test/legacy path: use the injected string-returning provider
    const rawPrompt = step.promptTemplate ?? "";
    const prompt = interpolate(rawPrompt, context);
    const rawOutput = await _llmProvider(prompt);

    try {
      const parsed = JSON.parse(rawOutput) as unknown;
      if (typeof parsed === "object" && parsed !== null) return { output: parsed as Record<string, unknown> };
    } catch {
      // Not JSON — treat as a text value mapped to the first output key
    }

    const firstKey = step.outputKeys[0] ?? "output";
    return { output: { [firstKey]: rawOutput } };
  }

  // Production path: resolve config from llmConfigStore via handleLlm
  const result = await handleLlm(step, context, userId ?? "");
  return { output: result.output, costLog: result.costLog };
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRetryPolicy(
  step: WorkflowStep,
  template: WorkflowTemplate
): WorkflowRetryPolicy | undefined {
  return step.retry ?? template.retry;
}

function computeRetryDelayMs(policy: WorkflowRetryPolicy, attempt: number): number {
  const baseInterval = Math.max(0, policy.intervalMs ?? 1_000);
  const maxInterval = policy.maxInterval ?? Number.POSITIVE_INFINITY;
  const delayFactor = policy.delayFactor ?? 2;

  switch (policy.type) {
    case "constant":
      return Math.min(baseInterval, maxInterval);
    case "exponential":
      return Math.min(baseInterval * delayFactor ** (attempt - 1), maxInterval);
    case "random": {
      const windowMs = Math.min(baseInterval * delayFactor ** (attempt - 1), maxInterval);
      return Math.floor(Math.random() * (windowMs + 1));
    }
    default:
      return baseInterval;
  }
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

    // Build memory helpers scoped to this run's userId + templateId
    const memoryUserId = userId ?? "anonymous";
    const memoryContext = {
      /**
       * Read the most relevant memory entries for a query.
       * Returns an array of { key, text } objects (top 5 by relevance).
       */
      read: (query: string): Array<{ key: string; text: string }> => {
        const results = memoryStore.search(query, memoryUserId, undefined, 5);
        return results.map((r) => ({ key: r.entry.key, text: r.entry.text }));
      },
      /**
       * Persist a value under a named key, scoped to this workflow run.
       */
      write: (key: string, value: unknown): void => {
        memoryStore.write({
          userId: memoryUserId,
          workflowId: template.id,
          workflowName: template.name,
          key,
          text: typeof value === "string" ? value : JSON.stringify(value),
        });
      },
    };

    // The execution context accumulates outputs from all steps + initial input + config
    // memory helpers are injected so LLM prompt templates can reference them.
    const context: Record<string, unknown> = { ...config, ...input, memory: memoryContext };
    const stepResults: StepResult[] = [];
    let lastExecutedStep: WorkflowStep | undefined;

    const appendResult = (result: StepResult): void => {
      stepResults.push(result);
      runStore.update(runId, { stepResults: [...stepResults] });
    };

    const executePhaseSteps = async (
      steps: WorkflowStep[] | undefined,
      phase: StepPhase
    ): Promise<StepResult | undefined> => {
      for (const step of steps ?? []) {
        const result = await this._executeStepWithRetry(
          step,
          context,
          config,
          runId,
          template,
          userId,
          phase
        );

        Object.assign(context, result.output);
        appendResult(result);
        lastExecutedStep = step;

        if (result.status === "failure") {
          this._applyFailureContext(context, result);
          return result;
        }
      }

      return undefined;
    };

    const mainFailure = await executePhaseSteps(template.steps, "main");

    let terminalError = mainFailure?.error;
    if (mainFailure && template.errors?.length) {
      const errorHandlerFailure = await executePhaseSteps(template.errors, "errors");
      terminalError = errorHandlerFailure?.error;
      if (!errorHandlerFailure) {
        terminalError = undefined;
      }
    }

    const finallyFailure = await executePhaseSteps(template._finally, "finally");
    if (finallyFailure) {
      terminalError = finallyFailure.error;
    }

    if (terminalError) {
      runStore.update(runId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: terminalError,
        stepResults,
      });
      return;
    }

    // Collect final output from context (keys produced by the last step)
    const lastStep = lastExecutedStep ?? template.steps[template.steps.length - 1];
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

  private async _executeStepWithRetry(
    step: WorkflowStep,
    context: Record<string, unknown>,
    config: Record<string, unknown>,
    runId: string,
    template: WorkflowTemplate,
    userId: string | undefined,
    phase: StepPhase
  ): Promise<StepResult> {
    const startedAt = Date.now();
    const retryPolicy = resolveRetryPolicy(step, template);
    const maxAttempts = retryPolicy?.maxAttempts ?? 1;

    let attemptCount = 0;
    let lastState: StepExecutionState = { output: {}, status: "success" };

    while (attemptCount < maxAttempts) {
      attemptCount += 1;
      lastState = await this._executeStepOnce(step, context, config, runId, template, userId);

      if (lastState.status !== "failure") {
        break;
      }

      const shouldRetry = Boolean(retryPolicy) && attemptCount < maxAttempts;
      if (!shouldRetry) {
        break;
      }

      const elapsedMs = Date.now() - startedAt;
      const delayMs = computeRetryDelayMs(retryPolicy!, attemptCount);
      const exceedsMaxDuration =
        retryPolicy?.maxDuration !== undefined && elapsedMs + delayMs > retryPolicy.maxDuration;

      if (exceedsMaxDuration) {
        break;
      }

      if (retryPolicy?.warningOnRetry) {
        console.warn(
          `[workflow] Retrying step ${step.id} (${step.name}) after attempt ${attemptCount}`
        );
      }

      await sleep(delayMs);
    }

    return {
      stepId: step.id,
      stepName: step.name,
      status: lastState.status,
      output: lastState.output,
      durationMs: Date.now() - startedAt,
      attemptCount,
      phase,
      ...(lastState.error ? { error: lastState.error } : {}),
      ...(lastState.agentSlotResults ? { agentSlotResults: lastState.agentSlotResults } : {}),
      ...(lastState.costLog ? { costLog: lastState.costLog } : {}),
    };
  }

  private async _executeStepOnce(
    step: WorkflowStep,
    context: Record<string, unknown>,
    config: Record<string, unknown>,
    runId: string,
    template: WorkflowTemplate,
    userId?: string
  ): Promise<StepExecutionState> {
    try {
      switch (step.kind) {
        case "trigger":
          return { output: await executeTrigger(step, context), status: "success" };
        case "llm": {
          const llmResult = await executeLlm(step, context, userId);
          return { output: llmResult.output, status: "success", costLog: llmResult.costLog };
        }
        case "transform":
          return { output: await executeTransform(step, context), status: "success" };
        case "condition":
          return { output: await executeCondition(step, context), status: "success" };
        case "action":
          return { output: await executeAction(step, context, config), status: "success" };
        case "output":
          return { output: await executeOutput(step, context), status: "success" };
        case "mcp": {
          const mcpResult = await handleMcp(step, context);
          return { output: mcpResult.output, status: "success" };
        }
        case "file_trigger": {
          const ftResult = await handleFileTrigger(step, context);
          return { output: ftResult.output, status: "success" };
        }
        case "agent": {
          const agentResult = await handleAgent(step, context, runId, userId ?? "");
          return {
            output: agentResult.output,
            status: "success",
            agentSlotResults: agentResult.agentSlotResults,
          };
        }
        case "approval": {
          const assignee = step.approvalAssignee ?? "unassigned";
          const message = step.approvalMessage ?? "Approval required to continue.";
          const timeoutMinutes = step.approvalTimeoutMinutes ?? 60;

          runStore.update(runId, { status: "awaiting_approval" });

          const { id: approvalId, promise: approvalPromise } = approvalStore.create({
            runId,
            templateName: template.name,
            stepId: step.id,
            stepName: step.name,
            assignee,
            message,
            timeoutMinutes,
          });

          const { approved, comment } = await approvalPromise;

          runStore.update(runId, { status: "running" });

          if (!approved) {
            return {
              output: { approved, approvalId, approverComment: comment ?? null },
              status: "failure",
              error: `Approval rejected${comment ? `: ${comment}` : " (timed out or declined)"}`,
            };
          }

          return {
            output: { approved, approvalId, approverComment: comment ?? null },
            status: "success",
          };
        }
        default:
          return { output: {}, status: "success" };
      }
    } catch (err) {
      return {
        output: {},
        status: "failure",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private _applyFailureContext(context: Record<string, unknown>, result: StepResult): void {
    context["error"] = result.error ?? `Step ${result.stepName} failed`;
    context["lastError"] = context["error"];
    context["failedStepId"] = result.stepId;
    context["failedStepName"] = result.stepName;
    context["failedPhase"] = result.phase ?? "main";
    context["failedAttemptCount"] = result.attemptCount ?? 1;
  }
}

export const workflowEngine = new WorkflowEngine();
