/**
 * Core workflow execution engine for AutoFlow.
 *
 * Executes a WorkflowTemplate step-by-step, tracking state in the run store.
 * Each step type has a dedicated executor. LLM steps call the pluggable
 * llmProvider — wire in a real provider via setLlmProvider() (see TODO below).
 */

import { randomUUID } from "node:crypto";
import {
  WorkflowTemplate,
  WorkflowRun,
  WorkflowStep,
  StepResult,
  AgentSlotResult,
} from "../types/workflow";
import { assertSafeOutboundUrl } from "../mcp/mcpUrlSecurity";
import { signOutboundBody } from "../webhooks/verifySignature";
// HEL-656: importing the barrel registers the built-in connector actions and
// exposes the dynamic action-library lookup. Registration is cheap (connector
// SDKs load lazily inside each action's invoke).
import { getConnectorAction } from "./connectorActions";
import { runStore } from "./runStore";
import { publishWorkspaceStreamEvent, type RunLifecyclePhase } from "./agentTrace/streamPublisher";
import { approvalStore } from "./approvalStore";
import { approvalPolicyStore } from "../approvals/policyStore";
import {
  ApprovalTierActionType,
  ApprovalTierMode,
  defaultApprovalTierPolicyForAction,
  isApprovalTierActionType,
  resolveApprovalTierActionType,
  resolveSpendAmountCents,
} from "../approvals/policyTypes";
import { handleLlm, handleMcp, handleFileTrigger, handleAgent, handleKnowledge } from "./stepHandlers";
import { safeEvalCondition } from "./safeConditionEval";
import { parseTransformAssignments, applyFieldAssignments } from "./transformStep";
import { resolveLoopJump } from "./loopStep";
import { resolveSwitchJump } from "./switchStep";
import { applyItemFilter } from "./filterStep";
import { resolveStopError } from "./stopErrorStep";
import { loadLatestWorkflowTemplate } from "./workflowTemplateLoader";
import {
  resolveSubWorkflowInput,
  nextSubWorkflowChain,
  SUB_WORKFLOW_CHAIN_KEY,
} from "./subWorkflowStep";
import { planErrorWorkflowDispatch, ERROR_WORKFLOW_MARKER } from "./errorWorkflowHook";
import { extractStructuredOutput } from "./structuredOutput";
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

/**
 * HEL-650: identity + step threaded to every action handler.
 *
 * `inputs`/`config` alone can't back a real handler: per-step settings
 * (e.g. a webhook URL) live on `step.config`, and connector services key
 * credential lookups on `userId` (e.g. `slackConnectorService.listChannels(userId)`).
 * `ActionContext` carries both so handlers can do real, workspace-scoped work.
 */
export interface ActionContext {
  /** The full workflow step — gives handlers access to `step.config`. */
  step: WorkflowStep;
  /** Run owner. Connector credential stores key on this. */
  userId?: string;
  /** Active workspace — tenant scoping / connector lookups. */
  workspaceId?: string;
  /** The full accumulated run context (read access for handlers). */
  context: Record<string, unknown>;
}

type ActionHandler = (
  inputs: Record<string, unknown>,
  config: Record<string, unknown>,
  action: ActionContext
) => Promise<Record<string, unknown>>;

// allowlist: in-process registry / runtime state (not customer data)
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

// HEL-753: the fabricated `crm.upsertLead` and `content.publish` stubs were
// removed here — they returned fake `CRM-…` / `CONT-…` ids and a synthetic
// success without any external side effect. Real tool execution now goes
// through the Composio connector action (`composio.execute`, step.config
// toolkit+slug) on the dynamic library. With these gone, a step that still
// references those action names falls through to the honest unknown-action stub
// (output keys → null) instead of fabricating a result.

// HEL-650 / HEL-647: real outbound webhook — first genuinely side-effecting
// action on the live registry path (replaces the silent unknown-action
// `{key:null}` stub). Reads the per-step URL from `step.config` (threaded via
// ActionContext), guards against SSRF, and optionally HMAC-signs the body.
// Honest failure (`{sent:false, error}`) when no URL is configured — never a
// fabricated success. The request body carries only the step's declared
// inputKeys, so secrets in the run context are not exfiltrated.
actionRegistry.set("webhook.send", async (inputs, config, action) => {
  const stepConfig: Record<string, unknown> = action.step.config ?? {};
  const url =
    typeof stepConfig["url"] === "string"
      ? (stepConfig["url"] as string)
      : typeof inputs["url"] === "string"
        ? (inputs["url"] as string)
        : "";
  if (!url) {
    return { sent: false, error: "webhook.send: no url configured" };
  }
  const secret =
    typeof inputs["outboundWebhookSecret"] === "string"
      ? (inputs["outboundWebhookSecret"] as string)
      : typeof config["outboundWebhookSecret"] === "string"
        ? (config["outboundWebhookSecret"] as string)
        : "";
  const event =
    typeof stepConfig["event"] === "string" ? (stepConfig["event"] as string) : "workflow.action";
  const bodyPayload = JSON.stringify({ event, data: inputs });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) {
    headers["X-AutoFlow-Signature"] = signOutboundBody(secret, bodyPayload);
  }
  // HEL-255 — SSRF guard: reject loopback / RFC-1918 / link-local /
  // cloud-metadata targets before issuing the request. Throws → step fails.
  await assertSafeOutboundUrl(url);
  const response = await fetch(url, { method: "POST", headers, body: bodyPayload });
  return { sent: true, status: response.status };
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
// Condition evaluator — HEL-254 / SEC-03, HEL-259 / SEC-14: delegates to
// safeConditionEval (jsep AST + allowlist walker, no JS eval / new Function).
// Errors fall back to false so workflow edge-routing stays safe.
// ---------------------------------------------------------------------------

function evalCondition(expression: string, context: Record<string, unknown>): boolean {
  try {
    return safeEvalCondition(expression, context);
  } catch {
    return false;
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stripMemory(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (key === "memory") continue;
    if (typeof value === "function" || value === undefined) continue;
    out[key] = value;
  }
  return cloneJson(out);
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

    // Legacy/test path uses the same chatty-tolerant extractor as the
    // production handlers so injected providers that emit
    // "Sure!\n```json\n…\n```" don't fall through to the string
    // fallback when their JSON is actually valid.
    let parsed: unknown = null;
    try {
      parsed = extractStructuredOutput(rawOutput, { label: "legacy-custom-provider" });
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === "object") {
      return { output: parsed as Record<string, unknown> };
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
  // HEL-671: real Set-Fields transform. When the step declares field
  // assignments (config.assignments), compute each field from the run context —
  // a literal, a {{template}}, a safe expression, or a copy/rename — and merge
  // the result into context for downstream steps. Falls back to the legacy
  // identity passthrough (copy declared outputKeys) when no assignments exist,
  // so pre-HEL-671 transform steps keep working unchanged.
  const assignments = parseTransformAssignments(step.config);
  if (assignments) {
    return applyFieldAssignments(assignments, context);
  }
  const out: Record<string, unknown> = {};
  for (const key of step.outputKeys) {
    if (key in context) out[key] = context[key];
  }
  return out;
}

async function executeMerge(
  step: WorkflowStep,
  context: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // HEL-667: a Merge step rejoins branches. On the linear / shared-context engine
  // each incoming branch has already merged its outputs into `context`, so the
  // merge node is a structural join — it surfaces the declared input keys present
  // in context as its output. (No fork-join wait: a single execution pointer
  // reaches the merge once, in array order.)
  const out: Record<string, unknown> = {};
  for (const key of step.inputKeys) {
    if (key in context) out[key] = context[key];
  }
  return out;
}

async function executeFilter(
  step: WorkflowStep,
  context: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // HEL-670: keep only the array items that pass the predicate; emit the filtered
  // array under the step's first output key, plus kept/dropped counts.
  const result = applyItemFilter(step, context);
  const outputKey = step.outputKeys[0] ?? "filtered";
  return {
    [outputKey]: result.kept,
    filteredIn: result.filteredIn,
    filteredOut: result.filteredOut,
  };
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
  config: Record<string, unknown>,
  userId?: string
): Promise<Record<string, unknown>> {
  const actionName = step.action;
  if (!actionName) return {};

  const inputs: Record<string, unknown> = {};
  for (const key of step.inputKeys) {
    inputs[key] = context[key] ?? config[key];
  }

  // HEL-650 / HEL-753: thread run identity + the step so handlers can read
  // step.config and resolve the workspace/user's connected integrations. The
  // workspace is needed by BOTH the connector-action library (Composio is
  // workspace-scoped) and the legacy ActionContext, so resolve it before the
  // dispatch branches.
  const workspaceId =
    typeof context["workspaceId"] === "string"
      ? (context["workspaceId"] as string)
      : typeof config["workspaceId"] === "string"
        ? (config["workspaceId"] as string)
        : undefined;

  // HEL-656: the dynamic connector-action library takes precedence over the
  // legacy in-process actionRegistry. A registered connector action resolves
  // its credential by the run owner's userId (+ optional connectionId from
  // step.config) and, for workspace-scoped brokers, the workspaceId — so a run
  // with no user can't perform it — fail honestly rather than fabricate success.
  const connectorAction = getConnectorAction(actionName);
  if (connectorAction) {
    if (!userId) {
      throw new Error(
        `Action '${actionName}' needs a run user to resolve its connector credentials`,
      );
    }
    const connectionId =
      typeof step.config?.["connectionId"] === "string"
        ? (step.config["connectionId"] as string)
        : undefined;
    return connectorAction.invoke({ userId, workspaceId, connectionId, inputs, config, step });
  }

  const handler = actionRegistry.get(actionName);
  if (!handler) {
    // Unknown action: return a stub with output keys set to null
    const out: Record<string, unknown> = {};
    for (const key of step.outputKeys) out[key] = null;
    return out;
  }

  const action: ActionContext = { step, userId, workspaceId, context };
  return handler(inputs, config, action);
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

    const run = await runStore.create({
      id: randomUUID(),
      templateId: template.id,
      templateName: template.name,
      workspaceId: this._resolveWorkspaceId(input, runConfig),
      status: "pending",
      startedAt: new Date().toISOString(),
      input,
      workflowDag: template,
      stepResults: [],
      runtimeState: {
        config: { ...runConfig },
        context: { ...runConfig, ...input },
        currentStepIndex: 0,
      },
      ...(userId !== undefined ? { userId } : {}),
    });

    // Execute asynchronously so the HTTP response returns immediately
    this._executeRun(run.id, template, input, runConfig, userId).catch((err) => {
      void runStore.update(run.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: String(err),
      });
      void this._publishRunLifecycle(run.id, "failed", { error: String(err) });
    });

    return run;
  }

  /**
   * HEL-478: execute an already-created, queued run.
   *
   * Unlike {@link startRun} (which creates the run row *and* executes it
   * inline), the run record here already exists with status `queued` —
   * created by the BullMQ enqueue paths in app.ts:
   *   - POST /api/runs                      (fresh run,     stepIndex 0)
   *   - POST /api/runs/:id/retry            (failed re-run, stepIndex 0)
   *   - POST /api/runs/:id/replay-with-latest (new run,     stepIndex 0)
   *   - POST /api/runs/:id/replay-from-step (cloned prefix, stepIndex N>0)
   *
   * The "runs" BullMQ worker (src/worker.ts) is the sole executor on the
   * queue path; it calls this for every non-cron job. We load the run's
   * persisted DAG + context, then drive {@link _runSteps} from
   * `startStepIndex`, which owns the `running → completed/failed`
   * transitions and per-step `step_results` persistence.
   *
   * Idempotency (HEL-107): only a run still in a *pre-execution* state
   * (`queued`/`pending`) is executed. A run already `running` or terminal
   * is left untouched and the call is a no-op, so a BullMQ retry of the
   * same job never re-runs side-effecting steps. (`_runSteps` re-executes
   * every step from `startStepIndex` with no per-step idempotency skip, so
   * re-entering a partially-complete run would double external effects —
   * the guard is what prevents that.)
   *
   * Step results / context selection:
   *   - `startStepIndex === 0` (fresh / retry / replay-with-latest): start
   *     from a CLEAN context (config + input) and an EMPTY step_results
   *     array. A retried run still carries the prior attempt's stale
   *     step_results + a polluted runtimeState.context, so we deliberately
   *     ignore both and re-run from scratch.
   *   - `startStepIndex > 0` (replay-from-step): the persisted
   *     runtimeState.context already layers the cloned prefix outputs over
   *     config + input, and run.stepResults holds the cloned prefix — both
   *     are authoritative, so we resume on top of them.
   */
  async executeQueuedRun(runId: string, startStepIndex = 0): Promise<void> {
    const run = await runStore.get(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    // Idempotency guard — see method doc.
    if (run.status !== "queued" && run.status !== "pending") {
      console.log(
        `[WorkflowEngine] executeQueuedRun skip run=${runId} status=${run.status} (already handled)`,
      );
      return;
    }

    const template = this._resolveTemplate(run);
    const config = run.runtimeState?.config ?? this._buildDefaultConfig(template);

    const resumeIndex =
      Number.isInteger(startStepIndex) && startStepIndex > 0 ? startStepIndex : 0;

    // Resume (stepIndex > 0): trust the persisted context + cloned prefix.
    // Fresh/retry (stepIndex 0): rebuild a clean context and drop any stale
    // step_results so the run re-executes from the top.
    const baseContext: Record<string, unknown> =
      resumeIndex > 0
        ? run.runtimeState?.context ?? { ...config, ...(run.input ?? {}) }
        : { ...config, ...(run.input ?? {}) };
    const stepResults: StepResult[] =
      resumeIndex > 0 ? (run.stepResults ?? []).map((sr) => ({ ...sr })) : [];

    // Build the memory snapshot BEFORE flipping to `running` so a transient
    // failure here leaves the run `queued` and a BullMQ retry can re-enter
    // cleanly (the idempotency guard only skips post-`running` runs).
    const context: Record<string, unknown> = {
      ...baseContext,
      memory: await this._buildMemoryContext(template, run.userId),
    };

    await runStore.update(runId, { status: "running" });
    void this._publishRunLifecycle(runId, "started");

    try {
      await this._runSteps(runId, template, config, context, stepResults, resumeIndex, run.userId);
    } catch (err) {
      // `_runSteps` marks the run `failed` for per-step failures itself; a
      // throw escaping it is an infra error (store write, memory, etc.).
      // Mark failed so the run isn't stranded `running`, then rethrow so the
      // worker's failed/DLQ machinery records the infra fault.
      await runStore.update(runId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: String(err),
      });
      void this._publishRunLifecycle(runId, "failed", { error: String(err) });
      throw err;
    }
  }

  /**
   * HEL-176: step-level replay.
   *
   * Creates a new run that resumes execution from `stepIndex`, cloning the
   * step_results for ordinals 0..stepIndex-1 so already-successful work
   * (LLM calls, side-effects, etc.) is not redone. Step results' `output`
   * is preserved verbatim, but each clone gets a fresh `idempotencyKey`
   * since the unique index on (idempotency_key) would reject duplicates.
   *
   * Validates:
   *   - `stepIndex` is in (0, template.steps.length)
   *     (use {@link startRun} for a full re-run; index 0 is rejected).
   *   - Every step_result with ordinal < stepIndex exists and is `success`.
   *
   * Fires-and-forgets the run loop (`_runSteps`) so the HTTP response
   * returns the pending run immediately, mirroring `startRun`'s pattern.
   */
  async replayFromStep(
    originalRunId: string,
    stepIndex: number,
    userId?: string,
    options?: { skipExecution?: boolean }
  ): Promise<WorkflowRun> {
    const original = await runStore.get(originalRunId);
    if (!original) {
      throw new Error(`Run not found: ${originalRunId}`);
    }

    const template = this._resolveTemplate(original);

    if (!Number.isInteger(stepIndex)) {
      throw new Error(`stepIndex must be an integer (received ${stepIndex})`);
    }
    if (stepIndex <= 0) {
      throw new Error(
        `stepIndex must be > 0 (received ${stepIndex}); use startRun for a full replay`
      );
    }
    if (stepIndex >= template.steps.length) {
      throw new Error(
        `stepIndex ${stepIndex} is beyond template length (${template.steps.length})`
      );
    }

    // Validate that the prefix [0..stepIndex) is fully successful so the
    // cloned outputs represent a coherent context for the resumed run.
    const prefix = original.stepResults.slice(0, stepIndex);
    if (prefix.length < stepIndex) {
      throw new Error(
        `Original run only has ${prefix.length} step result(s); cannot replay from ${stepIndex}`
      );
    }
    for (let i = 0; i < prefix.length; i += 1) {
      if (prefix[i].status !== "success") {
        throw new Error(
          `Step ordinal ${i} on original run is not 'success' (status='${prefix[i].status}'); cannot replay from ${stepIndex}`
        );
      }
    }

    // Clone the prefix step_results — preserve outputs but generate fresh
    // idempotency keys so the unique index doesn't reject the inserts.
    const newRunId = randomUUID();
    const clonedStepResults: StepResult[] = prefix.map((sr, ordinal) => ({
      stepId: sr.stepId,
      stepName: sr.stepName,
      status: "success" as const,
      output: cloneJson(sr.output),
      durationMs: sr.durationMs,
      ...(sr.agentSlotResults ? { agentSlotResults: cloneJson(sr.agentSlotResults) } : {}),
      ...(sr.costLog ? { costLog: cloneJson(sr.costLog) } : {}),
      idempotencyKey: `${newRunId}:${ordinal}:replay-from-step:${Date.now()}`,
    }));

    // Reconstruct the runtime context the same way _executeRun does:
    // start with config + input, then layer each cloned step's output.
    const config = original.runtimeState?.config
      ? cloneJson(original.runtimeState.config)
      : this._buildDefaultConfig(template);
    const context: Record<string, unknown> = {
      ...config,
      ...cloneJson(original.input),
    };
    for (const sr of clonedStepResults) {
      Object.assign(context, sr.output);
    }

    // Attach a memory helper so LLM prompts in the resumed run can read
    // memory entries (the snapshot-on-start pattern from _executeRun).
    context["memory"] = await this._buildMemoryContext(template, userId);

    const newRun = await runStore.create({
      id: newRunId,
      templateId: original.templateId,
      templateName: original.templateName,
      workspaceId: original.workspaceId,
      routineId: original.routineId,
      status: "pending",
      startedAt: new Date().toISOString(),
      input: cloneJson(original.input),
      workflowDag: original.workflowDag ? cloneJson(original.workflowDag) : template,
      stepResults: clonedStepResults.map((sr) => ({ ...sr, output: cloneJson(sr.output) })),
      runtimeState: {
        config: { ...config },
        // Drop the memory helper from runtimeState snapshots — it isn't
        // JSON-serialisable. makeRuntimeState scrubs it on the next
        // update; here we set the JSON-safe baseline explicitly.
        context: stripMemory(context),
        currentStepIndex: stepIndex,
      },
      ...(userId !== undefined ? { userId } : {}),
    });

    // HEL-176 Codex P1: caller may opt out of inline execution so the
    // endpoint can route through the BullMQ queue when Redis is
    // available — matching the POST /api/runs enqueue path. When
    // skipExecution is true we leave the new run in 'queued' so the
    // worker is the sole executor.
    if (options?.skipExecution) {
      await runStore.update(newRun.id, { status: "queued" });
      return { ...newRun, status: "queued" };
    }

    // Fire-and-forget the run loop so the HTTP response returns
    // immediately. _runSteps owns transitioning pending → running →
    // completed/failed and persisting per-step updates.
    void runStore
      .update(newRun.id, { status: "running" })
      .then(() => {
        void this._publishRunLifecycle(newRun.id, "started");
        return this._runSteps(newRun.id, template, config, context, clonedStepResults, stepIndex, userId);
      })
      .catch((err) => {
        void runStore.update(newRun.id, {
          status: "failed",
          completedAt: new Date().toISOString(),
          error: String(err),
        });
        void this._publishRunLifecycle(newRun.id, "failed", { error: String(err) });
      });

    return newRun;
  }

  /**
   * HEL-176 helper — pulls the {@link WorkflowTemplate} embedded in a run.
   * Throws if the run has no usable DAG (defensive — runs created via
   * the engine always persist `workflowDag`).
   */
  private _resolveTemplate(run: WorkflowRun): WorkflowTemplate {
    const dag = run.workflowDag;
    if (
      dag &&
      typeof dag === "object" &&
      !Array.isArray(dag) &&
      Array.isArray((dag as Partial<WorkflowTemplate>).steps)
    ) {
      return dag as WorkflowTemplate;
    }
    throw new Error(`Run ${run.id} has no workflow DAG; cannot replay`);
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

  // DASH-44: memoryStore went Postgres-backed (async). The template
  // interpolation layer expects a synchronous `read(query) -> entries`
  // shape, so we pre-fetch every memory entry the user owns once when
  // the run starts and serve `read` from that snapshot. A run that
  // takes seconds is fine with a per-run snapshot; long-running runs
  // that need fresh memory across steps would need an explicit refresh
  // hook (none of the templates do that today).
  private async _buildMemoryContext(
    template: WorkflowTemplate,
    userId?: string
  ): Promise<{
    read: (query: string) => Array<{ key: string; text: string }>;
    write: (key: string, value: unknown) => void;
  }> {
    const memoryUserId = userId ?? "anonymous";
    const snapshot = await memoryStore.search("", memoryUserId, undefined, 1000);
    const snapshotEntries = snapshot.map(({ entry }) => entry);

    function scoreEntry(text: string, query: string): number {
      const haystack = text.toLowerCase();
      const tokens = query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 1);
      if (tokens.length === 0) return 1;
      const hits = tokens.filter((t) => haystack.includes(t)).length;
      return hits / tokens.length;
    }

    return {
      read: (query: string): Array<{ key: string; text: string }> => {
        if (!query.trim()) {
          return snapshotEntries.map((entry) => ({ key: entry.key, text: entry.text }));
        }
        return snapshotEntries
          .map((entry) => ({ entry, score: scoreEntry(`${entry.key} ${entry.text}`, query) }))
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .map(({ entry }) => ({ key: entry.key, text: entry.text }));
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

  /**
   * HEL-673: run a *saved* workflow as a child of the current run and return its
   * output for the parent context. Loads the child's latest DAG (pool-backed
   * loader), guards nesting (depth cap + ancestor-cycle), creates a child run,
   * drives it through {@link _runSteps}, then returns its output. A child that
   * does not complete throws — so the parent `sub_workflow` step fails (and
   * composes with HEL-674 continueOnFail).
   */
  private async _runSubWorkflow(
    step: WorkflowStep,
    parentContext: Record<string, unknown>,
    userId?: string,
  ): Promise<Record<string, unknown>> {
    const config = (step.config ?? {}) as Record<string, unknown>;
    const workflowId =
      typeof config["workflowId"] === "string" ? config["workflowId"].trim() : "";
    if (!workflowId) {
      throw new Error("Sub-workflow step is missing config.workflowId");
    }

    const workspaceId = this._resolveWorkspaceId(parentContext, config);
    if (!workspaceId) {
      throw new Error("Sub-workflow step requires a workspaceId in the run context");
    }

    // Depth cap + ancestor-cycle guard (throws → this step fails).
    const childChain = nextSubWorkflowChain(parentContext, workflowId);

    const childTemplate = await loadLatestWorkflowTemplate({ workspaceId, workflowId });
    if (!childTemplate) {
      throw new Error(
        `Sub-workflow ${workflowId} has no runnable latest version in workspace ${workspaceId}`,
      );
    }

    const childInput = resolveSubWorkflowInput(config, parentContext, workspaceId);
    const childConfig: Record<string, unknown> = {
      ...this._buildDefaultConfig(childTemplate),
      workspaceId,
      [SUB_WORKFLOW_CHAIN_KEY]: childChain,
    };
    const childRunId = randomUUID();

    await runStore.create({
      id: childRunId,
      templateId: childTemplate.id,
      templateName: childTemplate.name,
      workspaceId,
      status: "running",
      startedAt: new Date().toISOString(),
      input: childInput,
      workflowDag: childTemplate,
      stepResults: [],
      runtimeState: {
        config: { ...childConfig },
        context: { ...childConfig, ...childInput },
        currentStepIndex: 0,
      },
      ...(userId !== undefined ? { userId } : {}),
    });

    const childContext: Record<string, unknown> = {
      ...childConfig,
      ...childInput,
      memory: await this._buildMemoryContext(childTemplate, userId),
    };

    await this._runSteps(childRunId, childTemplate, childConfig, childContext, [], 0, userId);

    const childRun = await runStore.get(childRunId);
    if (!childRun || childRun.status !== "completed") {
      throw new Error(
        `Sub-workflow ${workflowId} (run ${childRunId}) ${childRun?.status ?? "missing"}` +
          (childRun?.error ? `: ${childRun.error}` : ""),
      );
    }

    return {
      subWorkflowRunId: childRunId,
      subWorkflowId: workflowId,
      subWorkflowStatus: childRun.status,
      ...(childRun.output ?? {}),
    };
  }

  /**
   * HEL-772: best-effort — on run failure, fire the workflow's designated error
   * workflow (`template.onErrorWorkflowId`) with the failure context. Reuses the
   * pool-backed loader (HEL-673) and runs the error workflow inline via
   * {@link startRun} (no queue). A failed dispatch is swallowed so it can never
   * mask the original failure; the `__isErrorWorkflow` marker stops a failing
   * error workflow from looping.
   */
  private async _fireErrorWorkflow(
    template: WorkflowTemplate,
    config: Record<string, unknown>,
    context: Record<string, unknown>,
    failedRunId: string,
    failedStepId: string,
    error: string | undefined,
    userId?: string,
  ): Promise<void> {
    try {
      const plan = planErrorWorkflowDispatch({
        onErrorWorkflowId:
          typeof template.onErrorWorkflowId === "string" ? template.onErrorWorkflowId : undefined,
        workspaceId: this._resolveWorkspaceId(context, config),
        isErrorWorkflowRun:
          Boolean(context[ERROR_WORKFLOW_MARKER]) || Boolean(config[ERROR_WORKFLOW_MARKER]),
        failedRunId,
        failedStepId,
        templateId: template.id,
        templateName: template.name,
        error,
      });
      if (!plan) {
        return;
      }

      const errorTemplate = await loadLatestWorkflowTemplate({
        workspaceId: plan.input["workspaceId"] as string,
        workflowId: plan.workflowId,
      });
      if (!errorTemplate) {
        return;
      }

      await this.startRun(errorTemplate, plan.input, { [ERROR_WORKFLOW_MARKER]: true }, userId);
    } catch (err) {
      console.warn(
        `[WorkflowEngine] error-workflow dispatch failed for run=${failedRunId}: ${(err as Error).message}`,
      );
    }
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

  private _resolveWorkspaceId(
    context: Record<string, unknown>,
    config: Record<string, unknown>,
  ): string | undefined {
    const candidates = [
      context["workspaceId"],
      config["workspaceId"],
      context["companyId"],
      config["companyId"],
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }

    return undefined;
  }

  private _resolveApprovalAssignee(
    step: WorkflowStep,
    context: Record<string, unknown>,
    config: Record<string, unknown>,
    userId?: string,
  ): string {
    const governance =
      step.config?.["governance"] &&
      typeof step.config["governance"] === "object" &&
      !Array.isArray(step.config["governance"])
        ? (step.config["governance"] as Record<string, unknown>)
        : {};

    const candidates = [
      governance["assignee"],
      step.approvalAssignee,
      context["approvalAssignee"],
      config["approvalAssignee"],
      userId,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }

    return "unassigned";
  }

  private _resolveApprovalMessage(
    step: WorkflowStep,
    actionType: ApprovalTierActionType,
    mode: ApprovalTierMode,
    context: Record<string, unknown>,
  ): string {
    const governance =
      step.config?.["governance"] &&
      typeof step.config["governance"] === "object" &&
      !Array.isArray(step.config["governance"])
        ? (step.config["governance"] as Record<string, unknown>)
        : {};

    const configuredMessage =
      typeof governance["message"] === "string"
        ? (governance["message"] as string)
        : step.approvalMessage;

    if (configuredMessage?.trim()) {
      return configuredMessage.trim();
    }

    if (mode === "notify_only") {
      return `Notify-only governance event for ${actionType}: ${step.name}`;
    }

    return `Approval required for ${actionType}: ${step.name}`;
  }

  private async _createGovernanceApproval(params: {
    runId: string;
    template: WorkflowTemplate;
    step: WorkflowStep;
    currentStepIndex: number;
    config: Record<string, unknown>;
    context: Record<string, unknown>;
    actionType: ApprovalTierActionType;
    mode: ApprovalTierMode;
    userId?: string;
  }): Promise<{ decision: "approved" | "rejected" | "request_changes" | "timed_out"; comment?: string; approvalId: string }> {
    const assignee = this._resolveApprovalAssignee(
      params.step,
      params.context,
      params.config,
      params.userId,
    );
    const message = this._resolveApprovalMessage(
      params.step,
      params.actionType,
      params.mode,
      params.context,
    );
    const timeoutMinutes = params.step.approvalTimeoutMinutes ?? 60;

    await runStore.update(params.runId, { status: "awaiting_approval" });

    const { id: approvalId } = await approvalStore.create({
      runId: params.runId,
      templateId: params.template.id,
      templateName: params.template.name,
      stepId: params.step.id,
      stepName: params.step.name,
      assignee,
      message,
      timeoutMinutes,
      userId: params.userId,
      workspaceId: this._resolveWorkspaceId(params.context, params.config) ?? undefined,
    });

    await runStore.update(params.runId, {
      runtimeState: makeRuntimeState(
        params.config,
        params.context,
        params.currentStepIndex,
        approvalId,
      ),
    });

    if (params.mode === "notify_only") {
      await approvalStore.resolve(
        approvalId,
        "approved",
        "Auto-approved by notify-only governance policy.",
      );
    }

    const { decision, comment } = await approvalStore.waitForDecision(approvalId, 50);
    await runStore.update(params.runId, { status: "running" });
    return { decision, comment, approvalId };
  }

  private async _evaluateActionGovernance(params: {
    runId: string;
    template: WorkflowTemplate;
    step: WorkflowStep;
    currentStepIndex: number;
    config: Record<string, unknown>;
    context: Record<string, unknown>;
    userId?: string;
  }): Promise<{
    actionType?: ApprovalTierActionType;
    mode?: ApprovalTierMode;
    approvalId?: string;
    comment?: string;
    failure?: string;
  }> {
    const actionType = resolveApprovalTierActionType(params.step);
    if (!actionType) {
      return {};
    }

    const governance =
      params.step.config?.["governance"] &&
      typeof params.step.config["governance"] === "object" &&
      !Array.isArray(params.step.config["governance"])
        ? (params.step.config["governance"] as Record<string, unknown>)
        : {};
    const hasExplicitActionType = isApprovalTierActionType(governance["actionType"]);
    const workspaceId = this._resolveWorkspaceId(params.context, params.config);
    if (!workspaceId && !hasExplicitActionType) {
      return {};
    }

    const policy = workspaceId
      ? await approvalPolicyStore.get(workspaceId, params.userId ?? "", actionType)
      : defaultApprovalTierPolicyForAction("workspace-default", actionType);

    if (!policy) {
      return {};
    }

    if (actionType === "spend_above_threshold") {
      const spendAmountCents = resolveSpendAmountCents(params.step, params.context);
      if (
        spendAmountCents !== undefined &&
        policy.spendThresholdCents !== undefined &&
        spendAmountCents < policy.spendThresholdCents
      ) {
        return {
          actionType,
          mode: "auto_approve",
        };
      }
    }

    if (policy.mode === "auto_approve") {
      return {
        actionType,
        mode: policy.mode,
      };
    }

    const { decision, comment, approvalId } = await this._createGovernanceApproval({
      runId: params.runId,
      template: params.template,
      step: params.step,
      currentStepIndex: params.currentStepIndex,
      config: params.config,
      context: params.context,
      actionType,
      mode: policy.mode,
      userId: params.userId,
    });

    if (decision !== "approved") {
      return {
        actionType,
        mode: policy.mode,
        approvalId,
        comment,
        failure:
          decision === "timed_out"
            ? `Governance approval timed out${comment ? `: ${comment}` : ""}`
            : decision === "request_changes"
              ? `Governance requested changes${comment ? `: ${comment}` : ""}`
              : `Governance approval rejected${comment ? `: ${comment}` : ""}`,
      };
    }

    return {
      actionType,
      mode: policy.mode,
      approvalId,
      comment,
    };
  }

  /**
   * HEL-489: emit a `run.lifecycle` SSE event for a DAG run so the RunTray and
   * routine streams update live (the agent-prompt path publishes these; the DAG
   * path was silent — subscribers only refreshed on the ~20s poll). Best-effort
   * and fire-and-forget at the call sites; fetches the run for its workspace +
   * routine so the per-resource SSE channels can filter. DAG runs aren't owned
   * by a single agent, so `agentId` is empty.
   */
  private async _publishRunLifecycle(
    runId: string,
    phase: RunLifecyclePhase,
    extra?: { error?: string },
  ): Promise<void> {
    try {
      const run = await runStore.get(runId);
      if (!run?.workspaceId) {
        return;
      }
      await publishWorkspaceStreamEvent(run.workspaceId, {
        kind: "run.lifecycle",
        phase,
        runId,
        agentId: "",
        routineId: run.routineId ?? null,
        ...(extra?.error ? { error: extra.error } : {}),
      });
    } catch (err) {
      console.warn(
        `[WorkflowEngine] run.lifecycle publish failed run=${runId}: ${(err as Error).message}`,
      );
    }
  }

  private async _executeRun(
    runId: string,
    template: WorkflowTemplate,
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    userId?: string
  ): Promise<void> {
    await runStore.update(runId, { status: "running" });
    void this._publishRunLifecycle(runId, "started");

    // The execution context accumulates outputs from all steps + initial input + config
    // memory helpers are injected so LLM prompt templates can reference them.
    const context: Record<string, unknown> = {
      ...config,
      ...input,
      memory: await this._buildMemoryContext(template, userId),
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
      memory: await this._buildMemoryContext(template, userId),
    };
    const config = runtimeState.config;
    const stepResults = [...run.stepResults];

    await runStore.update(run.id, {
      status: "running",
      runtimeState: makeRuntimeState(config, context, runtimeState.currentStepIndex),
    });
    void this._publishRunLifecycle(run.id, "started");

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
      void this._publishRunLifecycle(run.id, "failed", { error: stepError });
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

    for (let currentStepIndex = startStepIndex; currentStepIndex < template.steps.length; currentStepIndex += 1) {
      const step = template.steps[currentStepIndex];
      await runStore.update(runId, {
        runtimeState: makeRuntimeState(config, context, currentStepIndex),
      });

      const start = Date.now();
      const resultIndex = stepResults.length;
      stepResults.push({
        stepId: step.id,
        stepName: step.name,
        status: "running",
        output: {},
        durationMs: 0,
      });
      runStore.update(runId, { stepResults: [...stepResults] });

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
          case "merge":
            stepOutput = await executeMerge(step, context);
            break;
          case "loop": {
            // HEL-668: bounded loop. resolveLoopJump increments the iteration
            // counter and returns a backward jump (to the body start) while
            // iterations remain + the break condition is false; otherwise it
            // exits. A hard cap guarantees termination.
            const loop = resolveLoopJump(step, template, context, currentStepIndex);
            stepOutput = loop.output;
            if (loop.jumpToStepIndex !== undefined) {
              jumpToStepIndex = loop.jumpToStepIndex;
            }
            break;
          }
          case "switch": {
            // HEL-669: N-way route. resolveSwitchJump evaluates the ordered rules
            // and returns a FORWARD jump to the first matching route's target (or
            // the fallback), skipping the non-matching branches. Forward-only, so
            // a Switch can never create a cycle.
            const sw = resolveSwitchJump(step, template, context, currentStepIndex);
            stepOutput = sw.output;
            if (sw.jumpToStepIndex !== undefined) {
              jumpToStepIndex = sw.jumpToStepIndex;
            }
            break;
          }
          case "filter":
            stepOutput = await executeFilter(step, context);
            break;
          case "stop_error": {
            // HEL-674: deliberate hard stop. Resolve the author's message +
            // optional type, then fail the step. `stop_error` is exempt from
            // continueOnFail (below), so this failure always aborts the run.
            const stop = resolveStopError(step, context);
            stepStatus = "failure";
            stepError = stop.message;
            stepOutput = {
              stopped: true,
              error: stop.message,
              ...(stop.errorType ? { errorType: stop.errorType } : {}),
            };
            break;
          }
          case "condition":
            stepOutput = await executeCondition(step, context);
            break;
          case "action":
          {
            const governance = await this._evaluateActionGovernance({
              runId,
              template,
              step,
              currentStepIndex,
              config,
              context,
              userId,
            });
            if (governance.failure) {
              stepStatus = "failure";
              stepError = governance.failure;
              stepOutput = {
                approved: false,
                approvalDecision:
                  governance.mode === "notify_only" ? "approved" : "rejected",
                approvalId: governance.approvalId ?? null,
                approverComment: governance.comment ?? null,
                governanceActionType: governance.actionType ?? null,
                governanceMode: governance.mode ?? null,
              };
              break;
            }

            const actionOutput = await executeAction(step, context, config, userId);
            stepOutput = {
              ...actionOutput,
              ...(governance.actionType
                ? {
                    governanceActionType: governance.actionType,
                    governanceMode: governance.mode ?? "auto_approve",
                    governanceApprovalId: governance.approvalId ?? null,
                  }
                : {}),
            };
            break;
          }
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
          case "sub_workflow":
            stepOutput = await this._runSubWorkflow(step, context, userId);
            break;
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
              userId,
              workspaceId: this._resolveWorkspaceId(context, config) ?? undefined,
            });

            await runStore.update(runId, {
              runtimeState: makeRuntimeState(config, context, currentStepIndex, approvalId),
            });

            const { decision, comment } = await approvalStore.waitForDecision(approvalId, 50);

            await runStore.update(runId, { status: "running" });

            if (decision === "request_changes") {
              const { targetStepIndex, error } = this._resolveRequestChangesTarget(
                template,
                step,
                currentStepIndex
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

      stepResults[resultIndex] = result;

      // Update run with latest step results so callers can see incremental progress
      await runStore.update(runId, { stepResults: [...stepResults] });

      // If a step fails, abort the run — unless the step opted into
      // continueOnFail (HEL-674): then the failure is recorded on the step
      // result + stashed into context for downstream branching, and the run
      // proceeds to the next step. Stop-And-Error (`stop_error`) is exempt — it
      // is a deliberate hard stop, so it always aborts regardless of the flag.
      if (stepStatus === "failure") {
        const stepConfig = (step.config ?? {}) as Record<string, unknown>;
        const continueOnFail =
          step.kind !== "stop_error" && stepConfig["continueOnFail"] === true;

        if (continueOnFail) {
          // Record the failure into context so downstream steps can branch on
          // it; the mutated context is persisted by the next iteration's
          // runtimeState write (or the final completion write).
          context["__lastError"] = stepError ?? null;
          const priorErrors: unknown[] = Array.isArray(context["__errors"])
            ? (context["__errors"] as unknown[])
            : [];
          context["__errors"] = [...priorErrors, { stepId: step.id, error: stepError ?? null }];
        } else {
          await runStore.update(runId, {
            status: "failed",
            completedAt: new Date().toISOString(),
            error: stepError,
            stepResults,
            runtimeState: makeRuntimeState(config, context, currentStepIndex),
          });
          void this._publishRunLifecycle(runId, "failed", { error: stepError });
          void this._fireErrorWorkflow(template, config, context, runId, step.id, stepError, userId);
          return;
        }
      }

      if (jumpToStepIndex !== undefined) {
        currentStepIndex = jumpToStepIndex - 1;
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
    void this._publishRunLifecycle(runId, "completed");
  }
}

export const workflowEngine = new WorkflowEngine();
