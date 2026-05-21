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
import { emitTrace } from "../engine/agentTrace/emitCallbacks";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { resolveModelForTier } from "../engine/llmRouter";
import { getProvider } from "../engine/llmProviders";
import { providerSupportsNativeAgentStream } from "../engine/llmProviders/capabilities";
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
  const providerSupportsSystemField =
    providerName === "anthropic" ||
    providerName === "openai" ||
    providerName === "groq" ||
    providerName === "fireworks" ||
    providerName === "together" ||
    providerName === "xai" ||
    providerName === "perplexity" ||
    providerName === "deepseek" ||
    providerName === "ollama" ||
    providerName === "localai" ||
    providerName === "opencode_zen";

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
    });
    await tracePublisher.publish({
      type: "turn.started",
      at: new Date().toISOString(),
    });
  }

  const handleTraceEvent = (event: AgentTraceEvent): void => {
    if (!tracePublisher) return;
    void (async () => {
      const envelope = await tracePublisher!.publish(event);
      await persistAgentTraceEvent(input.pool, envelope);
    })();

    if (
      streamEnabled &&
      event.type === "assistant.delta"
    ) {
      lastPreview = event.accumulated.slice(-TOKEN_PREVIEW_TAIL_CHARS);
      schedulePreviewPublish(input.runId);
    }
  };

  const nativeStream =
    providerSupportsNativeAgentStream(providerName) || tools.length === 0;

  const provider = getProvider({
    provider: resolved.config.provider,
    model,
    apiKey: resolved.apiKey,
    requestTimeoutMs: input.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    tools: tools.length > 0 ? tools : undefined,
    systemPrompt: providerSupportsSystemField ? systemPrompt : undefined,
    cacheSystemPrompt: providerName === "anthropic",
    onTrace: shouldTrace && nativeStream ? handleTraceEvent : undefined,
    onText:
      streamEnabled && !shouldTrace
        ? (_delta, accumulated) => {
            lastPreview = accumulated.slice(-TOKEN_PREVIEW_TAIL_CHARS);
            schedulePreviewPublish(input.runId);
          }
        : undefined,
  });

  const promptForProvider = providerSupportsSystemField
    ? input.userPrompt
    : `${systemPrompt}\n\n---\n\nUSER:\n${input.userPrompt}`;

  let response: LLMResponse;
  try {
    response = await provider(promptForProvider);

    if (shouldTrace && tracePublisher && !nativeStream) {
      emitTrace(handleTraceEvent, {
        type: "assistant.delta",
        delta: response.text,
        accumulated: response.text,
      });
      const usage = response.usage ?? { promptTokens: 0, completionTokens: 0 };
      await tracePublisher.publish({ type: "turn.completed", text: response.text, usage });
    }
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
    usage: response.usage ?? { promptTokens: 0, completionTokens: 0 },
    provider: resolved.config.provider,
    model,
    turnId: shouldTrace ? turnId : undefined,
  };
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
