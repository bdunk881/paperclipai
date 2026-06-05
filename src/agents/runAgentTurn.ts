/**
 * runAgentTurn (DASH-22 / HEL-137).
 *
 * High-level primitive for "run an agent for one turn with a goal
 * and a set of tools." Wraps the provider tool-loop with the
 * boilerplate every caller would otherwise repeat:
 *
 *   - Resolve the workspace's default LLM credential
 *   - Pick the model by tier
 *   - Splice memory guidance into the system prompt when save_memory
 *     is in the tool set
 *   - Optionally publish live trace events (tool calls, reasoning, text)
 *     and token previews to the agent presence pill
 *   - Return the full assistant text + cost + which tools fired
 */

import { randomUUID } from "crypto";
import type { Pool } from "pg";
import type { AgentTraceEvent } from "../engine/agentTrace/types";
import { AgentTracePublisher } from "../engine/agentTrace/tracePublisher";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { resolveModelForTier } from "../engine/llmRouter";
import type {
  AgentTool,
  LLMResponse,
} from "../engine/llmProviders/types";
import {
  publishAgentTokenPreview,
} from "./agentPresence";
import { persistAgentTraceEvent } from "./agentTraceStore";
import {
  createSaveMemoryAgentTool,
  SAVE_MEMORY_SYSTEM_PROMPT_GUIDANCE,
} from "./saveMemoryAgentTool";
import {
  filterToolsByPermissions,
  loadAgentIntegrationPermissions,
} from "./agentToolPermissions";
import { pickBackend, withAgentConversation } from "./runtime/runAgent";
import { readRuntimeNumber } from "./runtime/runtimeConfig";
import { loadAgentMcpServers } from "./runtime/mcpClient";
import { budgetMiddleware } from "./runtime/middleware/budgetMiddleware";
import { auditMiddleware } from "./runtime/middleware/auditMiddleware";
import { truncationMiddleware } from "./runtime/middleware/truncationMiddleware";
import { modelRetryMiddleware } from "./runtime/middleware/modelRetryMiddleware";
import { modelFallbackMiddleware } from "./runtime/middleware/modelFallbackMiddleware";
import { compactionMiddleware } from "./runtime/middleware/compactionMiddleware";
import { promptCachingMiddleware } from "./runtime/middleware/promptCachingMiddleware";
import { createDelegateToSubagentTool } from "./runtime/delegateToSubagentTool";
import type { AgentMiddleware } from "./runtime/middleware/types";
import type { AgentPermissionMode, ResolvedModelBinding } from "./runtime/types";

const TOKEN_PREVIEW_PUBLISH_INTERVAL_MS = 200;
const TOKEN_PREVIEW_TAIL_CHARS = 240;
const DEFAULT_TIMEOUT_MS = 120_000;

export type AgentRunTier = "lite" | "standard" | "power";

export interface RunAgentTurnInput {
  pool: Pool;
  workspaceId: string;
  userId: string;
  agentId: string;
  /** Correlates live trace SSE + persistence (from `runs.id`). */
  runId?: string;
  agentName: string;
  agentRoleKey?: string | null;
  systemPrompt: string;
  userPrompt: string;
  tier?: AgentRunTier;
  extraTools?: AgentTool[];
  includeSaveMemory?: boolean;
  canWriteAuthoritative?: boolean;
  /**
   * When true, publish canonical trace events to Redis/SSE and persist
   * them when `runId` is set. Also updates the presence pill from
   * assistant text deltas.
   */
  streamTrace?: boolean;
  /** @deprecated Prefer `streamTrace` — kept for backward compatibility. */
  streamToPresence?: boolean;
  requestTimeoutMs?: number;
  /**
   * Optional routine / ticket context. When set, the trace publisher
   * forwards each trace envelope to the workspace stream channel so the
   * per-routine and per-ticket SSE endpoints can surface the transcript
   * inline.
   */
  sourceRoutineId?: string | null;
  sourceTicketId?: string | null;
  /**
   * Permission mode for the run. "plan" maps to the Claude SDK's plan
   * mode (or a synthesized plan in the fallback backend); useful for
   * agents that should pause for human review before executing tools.
   * Defaults to "auto".
   */
  permissionMode?: AgentPermissionMode;
  /**
   * Skill keys this run should load. Falls back to the agent record's
   * stored `skills[]` when omitted. Pass an empty array to opt out.
   */
  skills?: string[];
  /**
   * When true (default), enforce the agent's monthly budget cap via the
   * pre-tool-use hook. Set false to bypass — e.g. for one-shot internal
   * runs like the hiring-plan generator that don't bill against an
   * agent.
   */
  enforceBudget?: boolean;
  /**
   * Depth in the `delegate_to_subagent` call chain. 0 (or undefined)
   * means "top-level run." Each recursive runAgentTurn call from the
   * delegate tool increments this. The delegate tool refuses at the
   * cap (MAX_DELEGATION_DEPTH = 3).
   */
  delegationDepth?: number;
  /**
   * The set of agent IDs already on the current delegation call stack.
   * The delegate tool refuses to call any agent already in this set,
   * which prevents A→B→A loops.
   */
  delegationLineage?: ReadonlySet<string>;
  /**
   * HEL-603 sub-agent affinity: the parent run's key `source_id`, inherited
   * down the delegation chain. Forwarded to the delegate tool, which prefers
   * a fresh ledger read and uses this as the chain fallback. (This run's own
   * LLM call doesn't consume it yet — the agent runtime isn't on the credits
   * path today — so it's carried purely for the next delegation hop.)
   */
  parentSourceHint?: string | null;
}

export interface RunAgentTurnResult {
  text: string;
  usage: NonNullable<LLMResponse["usage"]>;
  provider: string;
  model: string;
  turnId?: string;
}

export async function runAgentTurn(
  input: RunAgentTurnInput,
): Promise<RunAgentTurnResult> {
  const resolved = await llmConfigStore.getDecryptedDefault(input.userId);
  if (!resolved) {
    throw new Error(
      "No LLM provider configured for this workspace. Connect one in Settings → Models.",
    );
  }

  const model = resolveModelForTier(resolved.config.provider, input.tier ?? "standard");
  const streamEnabled = input.streamTrace ?? input.streamToPresence ?? false;
  const turnId = randomUUID();

  const candidateTools: AgentTool[] = [];
  if (input.includeSaveMemory !== false) {
    candidateTools.push(
      createSaveMemoryAgentTool({
        pool: input.pool,
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        userId: input.userId,
        canWriteAuthoritative: input.canWriteAuthoritative ?? false,
      }),
    );
  }
  // Org-chart delegation: when this agent has direct reports, give it
  // a `delegate_to_subagent` tool. The factory returns null for
  // non-managers, so we add an undefined-skipping push.
  const delegateTool = await createDelegateToSubagentTool({
    pool: input.pool,
    workspaceId: input.workspaceId,
    userId: input.userId,
    parentAgentId: input.agentId,
    depth: input.delegationDepth ?? 0,
    lineage: input.delegationLineage,
    sourceRoutineId: input.sourceRoutineId ?? null,
    sourceTicketId: input.sourceTicketId ?? null,
    parentSourceHint: input.parentSourceHint ?? null,
    tier: input.tier,
    permissionMode: input.permissionMode,
  });
  if (delegateTool) candidateTools.push(delegateTool);
  if (input.extraTools) candidateTools.push(...input.extraTools);

  const permissions = await loadAgentIntegrationPermissions({
    pool: input.pool,
    workspaceId: input.workspaceId,
    userId: input.userId,
    agentId: input.agentId,
  });
  const tools = filterToolsByPermissions(candidateTools, permissions);

  const systemPrompt = composeSystemPrompt(input, tools);

  let lastPreview = "";
  let publishHandle: ReturnType<typeof setTimeout> | null = null;
  function schedulePreviewPublish(runId?: string): void {
    if (publishHandle) return;
    publishHandle = setTimeout(() => {
      publishHandle = null;
      void publishAgentTokenPreview({
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        runId: runId ?? null,
        preview: lastPreview,
      });
    }, TOKEN_PREVIEW_PUBLISH_INTERVAL_MS);
  }

  const providerName = resolved.config.provider;
  if (!resolved.apiKey) {
    throw new Error(
      `LLM credential for provider ${providerName} has no decrypted API key.`,
    );
  }

  let tracePublisher: AgentTracePublisher | null = null;
  const shouldTrace = streamEnabled && Boolean(input.runId);

  if (shouldTrace && input.runId) {
    tracePublisher = new AgentTracePublisher({
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      runId: input.runId,
      turnId,
      provider: providerName,
      model,
      routineId: input.sourceRoutineId ?? null,
      ticketId: input.sourceTicketId ?? null,
    });
    await tracePublisher.publish({
      type: "turn.started",
      at: new Date().toISOString(),
    });
  }

  // Unified trace callback — persists envelopes when tracing is on and
  // always feeds assistant deltas into the presence preview when streaming
  // is enabled. The runtime backends emit the same canonical event shapes
  // as the legacy provider stream did.
  const handleTraceEvent = (event: AgentTraceEvent): void => {
    if (tracePublisher) {
      void (async () => {
        const envelope = await tracePublisher!.publish(event);
        await persistAgentTraceEvent(input.pool, envelope);
      })();
    }
    if (streamEnabled && event.type === "assistant.delta") {
      lastPreview = event.accumulated.slice(-TOKEN_PREVIEW_TAIL_CHARS);
      schedulePreviewPublish(input.runId);
    }
  };

  const binding: ResolvedModelBinding = {
    provider: providerName,
    model,
    apiKey: resolved.apiKey,
  };
  const backend = pickBackend(providerName);

  // Resolve skills, MCP servers, and the budget-enforcement hook before
  // we call into the backend. Skills come from explicit input override or
  // the agent row's stored list; MCP from the user's mcp_servers; the
  // budget hook is opt-out (enforceBudget defaults to true).
  const agentRow = await input.pool
    .query<{ skills: string[] | null; metadata: Record<string, unknown> | null }>(
      `SELECT skills, metadata FROM agents WHERE id = $1::uuid AND workspace_id = $2::uuid LIMIT 1`,
      [input.agentId, input.workspaceId],
    )
    .catch(() => ({
      rows: [] as Array<{ skills: string[] | null; metadata: Record<string, unknown> | null }>,
    }));
  const resolvedSkills = input.skills ?? agentRow.rows[0]?.skills ?? [];
  const runtimeMetadata = agentRow.rows[0]?.metadata;
  const toolResultMaxChars = readRuntimeNumber(runtimeMetadata, "toolResultMaxChars");
  const modelRetryMaxAttempts = readRuntimeNumber(runtimeMetadata, "modelRetryMaxAttempts");
  const compactionThresholdChars = readRuntimeNumber(runtimeMetadata, "compactionThresholdChars");
  // Per-agent model-call ceiling (HEL-629): overrides the backend's default
  // loop cap. Replaces the redundant model-call-limit middleware — the loop
  // already bounds model calls to maxToolIterations.
  const maxToolIterationsOverride = readRuntimeNumber(runtimeMetadata, "maxToolIterations");
  const mcpServers = await loadAgentMcpServers({ userId: input.userId });
  // Build the agent middleware pipeline. Model-phase first (only acts on the
  // fallback backend, which drives pipeline.modelCall), outermost-first:
  // context compaction (rewrites history) -> secondary-tier failover (wraps
  // retry) -> in-loop provider retry. Then tool-phase (every backend):
  // optional prompt caching, tool-result truncation, budget enforcement
  // (opt-out via enforceBudget), and audit logging.
  // (HEL-621/622/623/624/626/627/628.)
  const middleware: AgentMiddleware[] = [];
  if (isCompactionEnabled()) {
    middleware.push(compactionMiddleware({ thresholdChars: compactionThresholdChars }));
  }
  if (isModelFallbackEnabled()) {
    const fallbackModel = resolveModelForTier(
      providerName,
      fallbackTierFor(input.tier ?? "standard"),
    );
    if (fallbackModel && fallbackModel !== model) {
      middleware.push(modelFallbackMiddleware({ fallbackModel }));
    }
  }
  middleware.push(modelRetryMiddleware({ maxAttempts: modelRetryMaxAttempts }));
  if (isPromptCacheEnabled()) {
    middleware.push(promptCachingMiddleware());
  }
  middleware.push(truncationMiddleware(toolResultMaxChars));
  if (input.enforceBudget !== false) {
    middleware.push(
      budgetMiddleware({
        pool: input.pool,
        workspaceId: input.workspaceId,
        agentId: input.agentId,
      }),
    );
  }
  middleware.push(auditMiddleware());

  let response: { text: string; usage: NonNullable<LLMResponse["usage"]> };
  try {
    const runResult = await withAgentConversation(
      { runId: input.runId, agentId: input.agentId },
      () =>
        backend.run(
          {
            pool: input.pool,
            workspaceId: input.workspaceId,
            userId: input.userId,
            agentId: input.agentId,
            runId: input.runId,
            agentName: input.agentName,
            agentRoleKey: input.agentRoleKey,
            systemPrompt,
            userPrompt: input.userPrompt,
            tier: input.tier ?? "standard",
            tools,
            maxToolIterations:
              maxToolIterationsOverride !== undefined && maxToolIterationsOverride >= 1
                ? maxToolIterationsOverride
                : undefined,
            requestTimeoutMs: input.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
            onTrace: streamEnabled || shouldTrace ? handleTraceEvent : undefined,
            skills: resolvedSkills,
            mcpServers,
            permissionMode: input.permissionMode,
            middleware,
          },
          binding,
        ),
    );
    response = { text: runResult.text, usage: runResult.usage };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (tracePublisher) {
      await tracePublisher.publish({ type: "turn.error", message });
    }
    throw err;
  } finally {
    if (publishHandle) {
      clearTimeout(publishHandle);
      publishHandle = null;
    }
  }

  return {
    text: response.text,
    usage: response.usage,
    provider: providerName,
    model,
    turnId: shouldTrace ? turnId : undefined,
  };
}

const MODEL_FALLBACK_FLAG = "AUTOFLOW_AGENT_MODEL_FALLBACK_ENABLED";

function isModelFallbackEnabled(): boolean {
  const flag = process.env[MODEL_FALLBACK_FLAG];
  return flag === "1" || flag === "true";
}

const COMPACTION_FLAG = "AUTOFLOW_AGENT_COMPACTION_ENABLED";

function isCompactionEnabled(): boolean {
  const flag = process.env[COMPACTION_FLAG];
  return flag === "1" || flag === "true";
}

const PROMPT_CACHE_FLAG = "AUTOFLOW_AGENT_PROMPT_CACHE_ENABLED";

function isPromptCacheEnabled(): boolean {
  const flag = process.env[PROMPT_CACHE_FLAG];
  return flag === "1" || flag === "true";
}

/** Secondary tier to fail over to (same provider + API key, different model). */
function fallbackTierFor(tier: AgentRunTier): AgentRunTier {
  switch (tier) {
    case "power":
      return "standard";
    case "standard":
      return "lite";
    case "lite":
    default:
      return "standard";
  }
}

function composeSystemPrompt(
  input: RunAgentTurnInput,
  tools: AgentTool[],
): string {
  const segments: string[] = [input.systemPrompt.trim()];

  const hasSaveMemory = tools.some((t) => t.name === "save_memory");
  if (hasSaveMemory) {
    segments.push(SAVE_MEMORY_SYSTEM_PROMPT_GUIDANCE);
  }

  if (tools.length > 0) {
    const toolList = tools
      .map((t) => `- ${t.name}: ${t.description.split("\n")[0]}`)
      .join("\n");
    segments.push(`TOOLS AVAILABLE:\n${toolList}`);
  }

  segments.push(
    `IDENTITY:\nYou are ${input.agentName}${
      input.agentRoleKey ? `, a ${input.agentRoleKey}` : ""
    }.`,
  );

  return segments.join("\n\n");
}
