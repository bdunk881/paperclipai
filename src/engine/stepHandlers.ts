/**
 * Step handlers — one function per StepKind.
 *
 * Each handler receives the step definition and the current execution context
 * (all outputs accumulated so far, plus config values), and returns the
 * output produced by this step.
 */

import { WorkflowStep, AgentSlotResult, AgentMessage } from "../types/workflow";
import { createHash } from "crypto";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { getProvider } from "./llmProviders";
import { getBus, releaseBus } from "./agentBus";
import { classifyTierWithConfidence, resolveModelForTier, buildCostLog, LlmCostLog } from "./llmRouter";
import { logClassificationDecision } from "./classificationLog";

export type StepContext = Record<string, unknown>;

export interface StepHandlerResult {
  output: Record<string, unknown>;
  /** Set to true by a condition step when the false-branch steps should be skipped */
  skip?: boolean;
  /** Per-slot results for agent steps */
  agentSlotResults?: AgentSlotResult[];
  /** Cost and tier data for llm / agent steps */
  costLog?: LlmCostLog;
}

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
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
// LLM
// ---------------------------------------------------------------------------

export async function handleLlm(
  step: WorkflowStep,
  ctx: StepContext,
  userId: string
): Promise<StepHandlerResult> {
  if (!step.promptTemplate) {
    throw new Error(`LLM step "${step.id}" is missing a promptTemplate`);
  }

  const renderedPrompt = interpolate(step.promptTemplate, ctx);

  // Resolve config: step-level override or user's default
  const resolved = step.llmConfigId
    ? await llmConfigStore.getDecryptedAsync(step.llmConfigId, userId)
    : await llmConfigStore.getDecryptedDefaultAsync(userId);

  if (!resolved) {
    throw new Error(
      "LLM step failed: no LLM provider configured. Go to Settings > LLM Providers to connect one."
    );
  }

  // Determine the appropriate model tier for this step's complexity
  const classification = classifyTierWithConfidence(step, renderedPrompt.length);
  const tieredModel = resolveModelForTier(resolved.config.provider, classification.tier);
  logClassificationDecision({
    promptHash: hashPrompt(renderedPrompt),
    features: classification.features,
    selectedTier: classification.tier,
    confidenceScore: classification.confidence,
    modelId: tieredModel,
  });

  const provider = getProvider({
    provider: resolved.config.provider,
    model: tieredModel,
    apiKey: resolved.apiKey,
    credentials: resolved.credentials,
    options: resolved.config.providerOptions,
  });

  const response = await provider(renderedPrompt);

  // Attempt to parse JSON; fall back to mapping text to the first output key
  const output: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(response.text) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      Object.assign(output, parsed);
    } else {
      output[step.outputKeys[0] ?? "output"] = response.text;
    }
  } catch {
    output[step.outputKeys[0] ?? "output"] = response.text;
  }

  const costLog = buildCostLog(
    classification.tier,
    tieredModel,
    response.usage?.promptTokens ?? 0,
    response.usage?.completionTokens ?? 0
  );

  return { output, costLog };
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

// ---------------------------------------------------------------------------
// File Trigger
// ---------------------------------------------------------------------------

/**
 * Pass parsed file content through as step outputs.
 * The run input must contain { content, mimeType, filename } (injected by the
 * file-upload endpoint after calling parseFile).
 */
export async function handleFileTrigger(
  step: WorkflowStep,
  ctx: StepContext
): Promise<StepHandlerResult> {
  const content = ctx["content"] as string | undefined;
  const mimeType = ctx["mimeType"] as string | undefined;
  const filename = ctx["filename"] as string | undefined;

  if (!content) {
    throw new Error(
      `file_trigger step "${step.id}" — no parsed file content in context. ` +
        "Use the /api/runs/file endpoint to start a file-triggered run."
    );
  }

  const output: Record<string, unknown> = { content, mimeType, filename };

  // Also map declared outputKeys from context so downstream steps can reference them
  for (const key of step.outputKeys) {
    if (key in ctx && !(key in output)) output[key] = ctx[key];
  }

  return { output };
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

/**
 * Execute an MCP (Model Context Protocol) step.
 * Connects to the configured server URL and calls the named tool via JSON-RPC.
 */
export async function handleMcp(
  step: WorkflowStep,
  ctx: StepContext
): Promise<StepHandlerResult> {
  const serverUrl = step.mcpServerUrl;
  const toolName = step.mcpTool;

  if (!serverUrl) {
    throw new Error(`MCP step "${step.id}" is missing mcpServerUrl`);
  }
  if (!toolName) {
    throw new Error(`MCP step "${step.id}" is missing mcpTool`);
  }

  // Build tool arguments from input keys present in context
  const toolArgs: Record<string, unknown> = {};
  for (const key of step.inputKeys) {
    if (key in ctx) toolArgs[key] = ctx[key];
  }

  // Interpolate server URL in case it references a context variable (e.g. {{mcpUrl}})
  const resolvedUrl = interpolate(serverUrl, ctx);

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: toolName, arguments: toolArgs },
  });

  const response = await fetch(resolvedUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body,
  });

  if (!response.ok) {
    throw new Error(
      `MCP step "${step.id}" — server returned HTTP ${response.status}: ${response.statusText}`
    );
  }

  type McpRpcResponse = {
    result?: { content?: Array<{ type: string; text?: string }>; [k: string]: unknown };
    error?: { code: number; message: string };
  };

  const json = (await response.json()) as McpRpcResponse;

  if (json.error) {
    throw new Error(
      `MCP step "${step.id}" — RPC error ${json.error.code}: ${json.error.message}`
    );
  }

  // Normalise result: prefer structured content array, fall back to raw result
  const result = json.result ?? {};
  const content = result.content;
  let toolOutput: Record<string, unknown>;

  if (Array.isArray(content) && content.length > 0) {
    // Concatenate text blocks for the first output key; put full content under "content"
    const text = content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text as string)
      .join("\n");
    const firstKey = step.outputKeys[0] ?? "result";
    toolOutput = { [firstKey]: text || result, content };
  } else {
    // Treat the whole result object as output, mapped to declared output keys
    toolOutput = typeof result === "object" && result !== null ? (result as Record<string, unknown>) : {};
    if (step.outputKeys[0] && !(step.outputKeys[0] in toolOutput)) {
      toolOutput[step.outputKeys[0]] = result;
    }
  }

  return { output: toolOutput };
}

// ---------------------------------------------------------------------------
// Agent (parallel execution)
// ---------------------------------------------------------------------------

/**
 * Execute a multi-agent step.
 *
 * The manager agent:
 *  1. Builds a task description from `agentInstructions` + context.
 *  2. Publishes a dispatch message to each worker slot via the AgentBus.
 *  3. Spawns `subAgentSlots` (default 1) worker LLM calls in parallel.
 *  4. Each worker publishes its result back to the bus.
 *  5. The manager aggregates all worker outputs into a merged result.
 *
 * The bus can be observed by the RunMonitor in real-time; after the step
 * completes, `drain()` returns the full message log.
 *
 * Upgrade path: replace the in-process AgentBus with a Redis-backed
 * implementation by swapping getBus() without changing this function.
 */
export async function handleAgent(
  step: WorkflowStep,
  ctx: StepContext,
  runId: string,
  userId: string
): Promise<StepHandlerResult> {
  const slots = Math.max(1, step.subAgentSlots ?? 1);
  const instructions = step.agentInstructions ?? "Process the provided input and return a result.";
  const model = step.agentModel ?? "default";

  // Resolve the LLM provider once (shared across slots)
  const resolved = await llmConfigStore.getDecryptedDefaultAsync(userId);
  if (!resolved) {
    throw new Error(
      `Agent step "${step.id}" failed: no LLM provider configured. ` +
        "Go to Settings > LLM Providers to connect one."
    );
  }
  const provider = getProvider({
    provider: resolved.config.provider,
    model: resolved.config.model,
    apiKey: resolved.apiKey,
    credentials: resolved.credentials,
    options: resolved.config.providerOptions,
  });

  const bus = getBus(runId, step.id);

  // Manager dispatch: announce tasks to all slots
  for (let i = 0; i < slots; i++) {
    bus.publish({
      from: "manager",
      slotIndex: i,
      content: `Slot ${i}: ${instructions}`,
      timestamp: new Date().toISOString(),
    } satisfies AgentMessage);
  }

  // Build context summary for the prompt
  const contextSummary = Object.entries(ctx)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("\n");

  // Spawn N worker slots in parallel
  const slotResultPromises = Array.from({ length: slots }, async (_, i): Promise<AgentSlotResult> => {
    const slotStart = Date.now();
    const prompt = [
      `You are worker agent slot ${i} of ${slots} in a parallel execution.`,
      `Instructions: ${instructions}`,
      `Model preference: ${model}`,
      "",
      "Context:",
      contextSummary || "(no context)",
      "",
      `Your slot index is ${i}. Process your portion of the work and return a JSON object with your results.`,
      "If the context contains a list, process the items assigned to your slot.",
      "Return ONLY valid JSON.",
    ].join("\n");

    try {
      const response = await provider(prompt);
      let parsed: Record<string, unknown> = {};
      try {
        const raw = JSON.parse(response.text) as unknown;
        if (typeof raw === "object" && raw !== null) {
          parsed = raw as Record<string, unknown>;
        } else {
          parsed = { result: response.text };
        }
      } catch {
        parsed = { result: response.text };
      }

      bus.publish({
        from: "worker",
        slotIndex: i,
        content: `Slot ${i} completed: ${JSON.stringify(parsed).slice(0, 200)}`,
        timestamp: new Date().toISOString(),
      } satisfies AgentMessage);

      return {
        slotIndex: i,
        status: "success",
        output: parsed,
        durationMs: Date.now() - slotStart,
        messages: [],
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      bus.publish({
        from: "worker",
        slotIndex: i,
        content: `Slot ${i} failed: ${errMsg}`,
        timestamp: new Date().toISOString(),
      } satisfies AgentMessage);

      return {
        slotIndex: i,
        status: "failure",
        output: {},
        durationMs: Date.now() - slotStart,
        error: errMsg,
        messages: [],
      };
    }
  });

  const slotResults = await Promise.all(slotResultPromises);

  // Attach the full message log to each slot result
  const allMessages = bus.drain();
  for (const sr of slotResults) {
    sr.messages = allMessages.filter(
      (m) => m.slotIndex === sr.slotIndex || m.from === "manager"
    );
  }

  // Clean up bus
  releaseBus(runId, step.id);

  // Merge outputs: collect all slot outputs under `slots[i]` keys + a merged aggregate
  const mergedOutput: Record<string, unknown> = {};
  const successSlots = slotResults.filter((r) => r.status === "success");

  // Place each worker result under its slot key
  for (const sr of slotResults) {
    mergedOutput[`slot_${sr.slotIndex}`] = sr.output;
  }

  // Merge all success outputs into top-level keys (last writer wins for conflicts)
  for (const sr of successSlots) {
    for (const [k, v] of Object.entries(sr.output)) {
      if (!(`slot_${sr.slotIndex}` === k)) {
        mergedOutput[k] = v;
      }
    }
  }

  mergedOutput["_agentSlots"] = slots;
  mergedOutput["_agentSuccessCount"] = successSlots.length;

  const anyFailure = slotResults.some((r) => r.status === "failure");

  return {
    output: mergedOutput,
    agentSlotResults: slotResults,
    ...(anyFailure && successSlots.length === 0
      ? {}
      : {}),
  };
}
