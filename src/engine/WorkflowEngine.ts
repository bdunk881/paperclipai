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
} from "../types/workflow";
import { runStore } from "./runStore";
import { approvalStore } from "./approvalStore";
import { handleLlm, handleMcp, handleFileTrigger, handleAgent, handleKnowledge } from "./stepHandlers";
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

function makeRuntimeState(
  config: Record<string, unknown>,
  context: Record<string, unknown>,
  currentStepIndex: number,
  waitingApprovalId?: string
): NonNullable<WorkflowRun["runtimeState"]> {
  const serializableContext = JSON.parse(
    JSON.stringify(context, (key, value) => {
      if (key === "memory") {
        return undefined;
      }
      if (typeof value === "function" || value === undefined) {
        return undefined;
      }
      return value;
    })
  ) as Record<string, unknown>;

  return {
    config: JSON.parse(JSON.stringify(config)) as Record<string, unknown>,
    context: serializableContext,
    currentStepIndex,
    waitingApprovalId,
  };
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

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

export class WorkflowEngine {
  /**
   * Creates a new run record and starts execution asynchronously.
   * Returns immediately with the pending run — callers can poll GET /api/runs/:id.
   */
  async startRun(
    template: WorkflowTemplate,
    input: Record<string, unknown>,
    config?: Record<string, unknown>,
    userId?: string
  ): Promise<WorkflowRun> {
    const runConfig = { ...this._buildDefaultConfig(template), ...(config ?? {}) };

    const run: WorkflowRun = await runStore.create({
      id: uuidv4(),
      templateId: template.id,
      templateName: template.name,
      status: "pending",
      startedAt: new Date().toISOString(),
      input,
      stepResults: [],
      runtimeState: {
        config: { ...runConfig },
        context: { ...runConfig, ...input },
        currentStepIndex: 0,
      },
    });

    // Execute asynchronously so the HTTP response returns immediately
    this._executeRun(run.id, template, input, runConfig, userId).catch((err) => {
      void runStore.update(run.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: String(err),
      });
    });

    return run;
  }

  async resumeRun(
    runId: string,
    template: WorkflowTemplate,
    userId?: string
  ): Promise<WorkflowRun> {
    const run = await runStore.get(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (run.status !== "awaiting_approval") {
      throw new Error(`Run is not awaiting approval: ${runId}`);
    }

    if (!run.runtimeState) {
      throw new Error(`Run is missing runtime state: ${runId}`);
    }

    const approvalId =
      run.runtimeState.waitingApprovalId ?? (await approvalStore.findByRunId(run.id))?.id;
    if (!approvalId) {
      throw new Error(`Run is missing waiting approval id: ${run.id}`);
    }

    const approval = await approvalStore.get(approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`);
    }

    if (approval.status === "pending") {
      throw new Error(`Approval is still pending: ${approvalId}`);
    }

    this._resumePausedRun(run, template, userId).catch((err) => {
      void runStore.update(run.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: String(err),
      });
    });

    return (await runStore.get(runId)) ?? run;
  }

  private _buildDefaultConfig(template: WorkflowTemplate): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    for (const field of template.configFields) {
      if (field.defaultValue !== undefined) config[field.key] = field.defaultValue;
    }
    return config;
  }

  private _buildMemoryContext(
    template: WorkflowTemplate,
    userId?: string
  ): { read: (query: string) => Array<{ key: string; text: string }>; write: (key: string, value: unknown) => void } {
    const memoryUserId = userId ?? "anonymous";
    return {
      read: (query: string): Array<{ key: string; text: string }> => {
        void query;
        return [];
      },
      write: (key: string, value: unknown): void => {
        void memoryStore.write({
          userId: memoryUserId,
          workflowId: template.id,
          workflowName: template.name,
          key,
          text: typeof value === "string" ? value : JSON.stringify(value),
        });
      },
    };
  }

  private _resolveRequestChangesTarget(
    template: WorkflowTemplate,
    step: WorkflowStep,
    stepIndex: number
  ): { targetStepIndex?: number; error?: string } {
    const targetStepId = step.approvalRequestChangesStepId;
    const targetStepIndex = targetStepId
      ? template.steps.findIndex((candidate) => candidate.id === targetStepId)
      : -1;

    if (!targetStepId) {
      return { error: "Approval requested changes but no approvalRequestChangesStepId is configured" };
    }

    if (targetStepIndex === -1) {
      return { error: `Approval requested changes but target step was not found: ${targetStepId}` };
    }

    if (targetStepIndex >= stepIndex) {
      return { error: `Approval requested changes but target step must be earlier in the workflow: ${targetStepId}` };
    }

    return { targetStepIndex };
  }

  private async _executeRun(
    runId: string,
    template: WorkflowTemplate,
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    userId?: string
  ): Promise<void> {
    await runStore.update(runId, { status: "running" });

    // The execution context accumulates outputs from all steps + initial input + config
    // memory helpers are injected so LLM prompt templates can reference them.
    const context: Record<string, unknown> = {
      ...config,
      ...input,
      memory: this._buildMemoryContext(template, userId),
    };
    const stepResults: StepResult[] = [];

    await this._runSteps(runId, template, config, context, stepResults, 0, userId);
  }

  private async _resumePausedRun(
    run: WorkflowRun,
    template: WorkflowTemplate,
    userId?: string
  ): Promise<void> {
    const runtimeState = run.runtimeState;
    if (!runtimeState) {
      throw new Error(`Run is missing runtime state: ${run.id}`);
    }

    const step = template.steps[runtimeState.currentStepIndex];
    if (!step || step.kind !== "approval") {
      throw new Error(`Run is not paused on an approval step: ${run.id}`);
    }

    const approvalId =
      runtimeState.waitingApprovalId ?? (await approvalStore.findByRunId(run.id))?.id;
    if (!approvalId) {
      throw new Error(`Run is missing waiting approval id: ${run.id}`);
    }

    const approval = await approvalStore.get(approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`);
    }

    if (approval.status === "pending") {
      throw new Error(`Approval is still pending: ${approvalId}`);
    }

    const context: Record<string, unknown> = {
      ...runtimeState.context,
      memory: this._buildMemoryContext(template, userId),
    };
    const config = runtimeState.config;
    const stepResults = [...run.stepResults];

    await runStore.update(run.id, {
      status: "running",
      runtimeState: makeRuntimeState(config, context, runtimeState.currentStepIndex),
    });

    let stepStatus: StepResult["status"] = "success";
    let stepError: string | undefined;
    let nextStepIndex = runtimeState.currentStepIndex + 1;

    if (approval.status === "request_changes") {
      const { targetStepIndex, error } = this._resolveRequestChangesTarget(
        template,
        step,
        runtimeState.currentStepIndex
      );
      if (error) {
        stepStatus = "failure";
        stepError = error;
      } else {
        nextStepIndex = targetStepIndex!;
      }
    } else if (approval.status !== "approved") {
      stepStatus = "failure";
      stepError =
        approval.status === "timed_out"
          ? `Approval timed out${approval.comment ? `: ${approval.comment}` : ""}`
          : `Approval rejected${approval.comment ? `: ${approval.comment}` : ""}`;
    }

    const stepOutput = {
      approved: approval.status === "approved",
      approvalDecision: approval.status,
      approvalId,
      approverComment: approval.comment ?? null,
    };

    Object.assign(context, stepOutput);

    stepResults.push({
      stepId: step.id,
      stepName: step.name,
      status: stepStatus,
      output: stepOutput,
      durationMs: 0,
      ...(stepError ? { error: stepError } : {}),
    });

    await runStore.update(run.id, {
      stepResults,
      runtimeState: makeRuntimeState(config, context, runtimeState.currentStepIndex),
    });

    if (stepStatus === "failure") {
      await runStore.update(run.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: stepError,
        stepResults,
        runtimeState: makeRuntimeState(config, context, runtimeState.currentStepIndex),
      });
      return;
    }

    await this._runSteps(run.id, template, config, context, stepResults, nextStepIndex, userId);
  }

  private async _runSteps(
    runId: string,
    template: WorkflowTemplate,
    config: Record<string, unknown>,
    context: Record<string, unknown>,
    stepResults: StepResult[],
    startStepIndex: number,
    userId?: string
  ): Promise<void> {

    for (let stepIndex = startStepIndex; stepIndex < template.steps.length; stepIndex += 1) {
      const step = template.steps[stepIndex];
      await runStore.update(runId, {
        runtimeState: makeRuntimeState(config, context, stepIndex),
      });

      const start = Date.now();
      let stepOutput: Record<string, unknown> = {};
      let stepError: string | undefined;
      let stepStatus: StepResult["status"] = "success";
      let agentSlotResults: AgentSlotResult[] | undefined;
      let stepCostLog: LlmCostLog | undefined;
      let jumpToStepIndex: number | undefined;

      try {
        switch (step.kind) {
          case "trigger":
            stepOutput = await executeTrigger(step, context);
            break;
          case "llm": {
            const llmResult = await executeLlm(step, context, userId);
            stepOutput = llmResult.output;
            stepCostLog = llmResult.costLog;
            break;
          }
          case "knowledge": {
            const knowledgeResult = await handleKnowledge(step, context, userId ?? "");
            stepOutput = knowledgeResult.output;
            break;
          }
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
          case "mcp": {
            const mcpResult = await handleMcp(step, context);
            stepOutput = mcpResult.output;
            break;
          }
          case "file_trigger": {
            const ftResult = await handleFileTrigger(step, context);
            stepOutput = ftResult.output;
            break;
          }
          case "agent": {
            const agentResult = await handleAgent(step, context, runId, userId ?? "");
            stepOutput = agentResult.output;
            agentSlotResults = agentResult.agentSlotResults;
            break;
          }
          // approval steps — pause the run and wait for human resolution
          case "approval": {
            const assignee = step.approvalAssignee ?? "unassigned";
            const message = step.approvalMessage ?? "Approval required to continue.";
            const timeoutMinutes = step.approvalTimeoutMinutes ?? 60;

            await runStore.update(runId, { status: "awaiting_approval" });

            const { id: approvalId } = await approvalStore.create({
              runId,
              templateId: template.id,
              templateName: template.name,
              stepId: step.id,
              stepName: step.name,
              assignee,
              message,
              timeoutMinutes,
            });

            await runStore.update(runId, {
              runtimeState: makeRuntimeState(config, context, stepIndex, approvalId),
            });

            const { decision, comment } = await approvalStore.waitForDecision(approvalId, 50);

            await runStore.update(runId, { status: "running" });

            if (decision === "request_changes") {
              const { targetStepIndex, error } = this._resolveRequestChangesTarget(
                template,
                step,
                stepIndex
              );
              if (error) {
                stepStatus = "failure";
                stepError = error;
              } else {
                jumpToStepIndex = targetStepIndex;
              }
            } else if (decision !== "approved") {
              stepStatus = "failure";
              stepError =
                decision === "timed_out"
                  ? `Approval timed out${comment ? `: ${comment}` : ""}`
                  : `Approval rejected${comment ? `: ${comment}` : ""}`;
            }

            stepOutput = {
              approved: decision === "approved",
              approvalDecision: decision,
              approvalId,
              approverComment: comment ?? null,
            };
            break;
          }
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
        ...(agentSlotResults ? { agentSlotResults } : {}),
        ...(stepCostLog ? { costLog: stepCostLog } : {}),
      };

      stepResults.push(result);

      // Update run with latest step results so callers can see incremental progress
      await runStore.update(runId, { stepResults: [...stepResults] });

      // If a step fails, abort the run
      if (stepStatus === "failure") {
        await runStore.update(runId, {
          status: "failed",
          completedAt: new Date().toISOString(),
          error: stepError,
          stepResults,
          runtimeState: makeRuntimeState(config, context, stepIndex),
        });
        return;
      }

      if (jumpToStepIndex !== undefined) {
        stepIndex = jumpToStepIndex - 1;
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

    await runStore.update(runId, {
      status: "completed",
      completedAt: new Date().toISOString(),
      output,
      stepResults,
      runtimeState: makeRuntimeState(config, context, template.steps.length - 1),
    });
  }
}

export const workflowEngine = new WorkflowEngine();
