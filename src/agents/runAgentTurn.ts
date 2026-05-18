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
 *   - Optionally publish streaming token previews to the agent
 *     presence pill
 *   - Return the full assistant text + cost + which tools fired
 *
 * The function intentionally doesn't own the *decision* of when to
 * call an agent — that's the route handler's job (Check-in, Hand-off,
 * scheduled routine, etc.). It just gives those handlers a clean
 * one-call surface.
 *
 * NOT covered here:
 *   - Multi-turn conversation persistence (each call is one turn)
 *   - HITL approval interception (will land with the engine-level
 *     approval policy plumbing)
 *   - Cost ceiling pre-checks (call sites still do that themselves)
 */

import type { Pool } from "pg";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { resolveModelForTier } from "../engine/llmRouter";
import { getProvider } from "../engine/llmProviders";
import type {
  AgentTool,
  LLMResponse,
} from "../engine/llmProviders/types";
import {
  publishAgentTokenPreview,
} from "./agentPresence";
import {
  createSaveMemoryAgentTool,
  SAVE_MEMORY_SYSTEM_PROMPT_GUIDANCE,
} from "./saveMemoryAgentTool";

const TOKEN_PREVIEW_PUBLISH_INTERVAL_MS = 200;
const TOKEN_PREVIEW_TAIL_CHARS = 240;
const DEFAULT_TIMEOUT_MS = 120_000;

export type AgentRunTier = "lite" | "standard" | "power";

export interface RunAgentTurnInput {
  pool: Pool;
  workspaceId: string;
  userId: string;
  agentId: string;
  /** Free-text role identity that drives prompt voice + tone. */
  agentName: string;
  /** Owner-facing role like "support triage", "data analyst". */
  agentRoleKey?: string | null;
  /**
   * Caller-provided system prompt. The wrapper appends memory
   * guidance to it when save_memory is enabled. Keep it focused on
   * THIS agent's job + constraints.
   */
  systemPrompt: string;
  /** The actual user / event prompt for this turn. */
  userPrompt: string;
  /** Which model tier to bind the call to. Defaults to "standard". */
  tier?: AgentRunTier;
  /**
   * Additional tools the agent can call beyond the built-ins. The
   * wrapper assembles the final tool list (save_memory + these) and
   * forwards to the provider's tool loop.
   */
  extraTools?: AgentTool[];
  /**
   * Toggle the save_memory built-in tool. Defaults to true. Set
   * false for cheap classifier-style calls where memory is overkill.
   */
  includeSaveMemory?: boolean;
  /** Forwards to saveMemory's permission gate. Default false. */
  canWriteAuthoritative?: boolean;
  /**
   * When true, the wrapper streams assistant text into the agent
   * presence pill via the existing token-preview Redis channel. No-op
   * when the underlying provider doesn't support streaming.
   */
  streamToPresence?: boolean;
  /** Hard wall-clock cap on the provider call. */
  requestTimeoutMs?: number;
}

export interface RunAgentTurnResult {
  text: string;
  usage: NonNullable<LLMResponse["usage"]>;
  provider: string;
  model: string;
}

/**
 * Run one agentic turn against the workspace's default LLM.
 *
 * Returns the model's final text + token usage so the route handler
 * can persist a transcript / charge spend / surface the reply.
 */
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

  const tools: AgentTool[] = [];
  if (input.includeSaveMemory !== false) {
    tools.push(
      createSaveMemoryAgentTool({
        pool: input.pool,
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        userId: input.userId,
        canWriteAuthoritative: input.canWriteAuthoritative ?? false,
      }),
    );
  }
  if (input.extraTools) tools.push(...input.extraTools);

  const systemPrompt = composeSystemPrompt(input, tools);

  // Streaming token-preview wiring. Debounced to ~5/s so Redis
  // traffic stays proportional to what humans can read in the pill.
  let lastPreview = "";
  let publishHandle: ReturnType<typeof setTimeout> | null = null;
  function schedulePreviewPublish(): void {
    if (publishHandle) return;
    publishHandle = setTimeout(() => {
      publishHandle = null;
      void publishAgentTokenPreview({
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        preview: lastPreview,
      });
    }, TOKEN_PREVIEW_PUBLISH_INTERVAL_MS);
  }

  const provider = getProvider({
    provider: resolved.config.provider,
    model,
    apiKey: resolved.apiKey,
    requestTimeoutMs: input.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    tools: tools.length > 0 ? tools : undefined,
    onText:
      input.streamToPresence && tools.length === 0
        ? (_delta, accumulated) => {
            lastPreview = accumulated.slice(-TOKEN_PREVIEW_TAIL_CHARS);
            schedulePreviewPublish();
          }
        : undefined,
  });

  // The prompt the provider receives concatenates the system prompt
  // and the user prompt. For Anthropic specifically, the SDK uses
  // `system` + `messages: [{role: "user", content}]`. The
  // `getProvider` shape today is `(prompt: string) => …` — so we
  // inline the system bracket. This works because Anthropic ignores
  // the convention and reads the whole text; when we add OpenAI's
  // Agents SDK runner the wrapper will fork on provider here.
  const composedPrompt = `${systemPrompt}\n\n---\n\nUSER:\n${input.userPrompt}`;

  let response: LLMResponse;
  try {
    response = await provider(composedPrompt);
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
