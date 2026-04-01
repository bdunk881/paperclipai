/**
 * Step handlers — one function per StepKind.
 *
 * Each handler receives the step definition and the current execution context
 * (all outputs accumulated so far, plus config values), and returns the
 * output produced by this step.
 */

import { WorkflowStep } from "../types/workflow";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { getProvider } from "./llmProviders";

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
    ? llmConfigStore.getDecrypted(step.llmConfigId, userId)
    : llmConfigStore.getDecryptedDefault(userId);

  if (!resolved) {
    throw new Error(
      "LLM step failed: no LLM provider configured. Go to Settings > LLM Providers to connect one."
    );
  }

  const provider = getProvider({
    provider: resolved.config.provider,
    model: resolved.config.model,
    apiKey: resolved.apiKey,
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
