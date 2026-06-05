/**
 * OpenAIAgentsBackend — agent backend that drives an OpenAI run via
 * `@openai/agents`.
 *
 * Architecture notes:
 *   - Same-process: the SDK calls the OpenAI API directly via `openai`
 *     (no subprocess). Much lighter than ClaudeSdkBackend.
 *   - Our `AgentTool[]` are wrapped with the SDK's `tool()` helper using
 *     `strict: false` so we can pass raw JSON Schema for `parameters`
 *     (no zod conversion needed).
 *   - Subagent delegation is expressed via SDK `handoffs`: each subagent
 *     becomes its own `Agent` instance the parent can transfer the
 *     conversation to.
 *   - Live trace events are synthesized from the run result. The SDK has
 *     a streaming surface (`run(..., { stream: true })`) we can plug in
 *     later when we want token-level deltas; for the first cut we emit
 *     turn.started / tool_call.completed / tool_result / turn.completed.
 *
 * Roll-out: this backend is opt-in via the `AUTOFLOW_AGENT_SDK_ENABLED`
 * env var. Default agent traffic continues through FallbackAgentBackend.
 */

import { emitTrace } from "../../engine/agentTrace/emitCallbacks";
import { previewToolOutput } from "../../engine/agentTrace/redact";
import type { AgentTool } from "../../engine/llmProviders/types";
import {
  appendSkillsToPrompt,
  resolveSkills,
  type LoadedSkill,
} from "../../skills/skillsLoader";
import { buildPipeline, type MiddlewarePipeline } from "./middleware/pipeline";
import type { AgentRunContext, ToolCall, ToolOutcome } from "./middleware/types";
import type {
  AgentBackend,
  AgentMcpServer,
  AgentRunInput,
  AgentRunResult,
  ResolvedModelBinding,
  SubagentRef,
} from "./types";

const DEFAULT_MAX_TURNS = 8;

export class OpenAIAgentsBackend implements AgentBackend {
  readonly name = "openai_agents" as const;

  async run(
    input: AgentRunInput,
    binding: ResolvedModelBinding,
  ): Promise<AgentRunResult> {
    const sdk = await import("@openai/agents");

    // OpenAI client picks up OPENAI_API_KEY from env. We set it locally
    // for the duration of the call so multi-tenant credentials don't
    // bleed across runs.
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = binding.apiKey;

    try {
      // HEL-621: route every tool call through the shared middleware pipeline
      // (budget / audit / future tool-phase middleware). Until now this
      // backend ignored `input.hooks` entirely, so budget enforcement and
      // audit logging silently never ran on the OpenAI Agents path.
      const pipeline = buildPipeline(input.hooks);
      const ctx: AgentRunContext = {
        run: input,
        binding,
        messages: [],
        usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
        state: new Map(),
        backend: this.name,
      };
      const sdkTools = (input.tools ?? []).map((t) =>
        buildSdkTool(sdk, t, pipeline, ctx, input.onTrace),
      );

      // Skills are vendor-agnostic — we fold the same SKILL.md bodies
      // into the parent system prompt and into every handoff agent's
      // instructions, so a skill behaves identically on OpenAI as it
      // does on Claude / Gemini / Mistral / Bedrock / Vertex.
      const loadedSkills = resolveSkills(input.skills ?? []);
      const systemWithSkills = appendSkillsToPrompt(
        input.systemPrompt,
        loadedSkills,
      );

      const handoffAgents = (input.subagents ?? []).map((sub) =>
        buildHandoffAgent(sdk, sub, binding.model, loadedSkills),
      );

      // HEL-222: pass through the user's connected MCP servers to the
      // OpenAI Agents SDK's native MCP support. The SDK opens the
      // streamable-HTTP connection, lists the remote tools, and
      // registers them on the agent — no manual bridge needed.
      const mcpServers = (input.mcpServers ?? []).map((s) =>
        buildSdkMcpServer(sdk, s),
      );

      const agent = new sdk.Agent({
        name: input.agentName,
        instructions: systemWithSkills,
        model: binding.model,
        tools: sdkTools,
        handoffs: handoffAgents,
        mcpServers,
      });

      if (input.onTrace) {
        emitTrace(input.onTrace, {
          type: "turn.started",
          at: new Date().toISOString(),
        });
      }

      const result = await sdk.run(agent, input.userPrompt, {
        maxTurns: input.maxToolIterations ?? DEFAULT_MAX_TURNS,
      });

      const usage = {
        promptTokens: result.runContext.usage?.inputTokens ?? 0,
        completionTokens: result.runContext.usage?.outputTokens ?? 0,
        cachedPromptTokens: undefined,
      };

      // sdk.extractAllTextOutput pulls the assistant's final text out of
      // the final message stack — it's the safest way to surface "what
      // did the agent say at the end."
      const text =
        typeof result.finalOutput === "string"
          ? result.finalOutput
          : sdk.extractAllTextOutput(result.newItems);

      if (input.onTrace) {
        emitTrace(input.onTrace, { type: "turn.completed", text, usage });
      }

      return {
        text,
        usage,
        provider: binding.provider,
        model: binding.model,
        backend: this.name,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (input.onTrace) {
        emitTrace(input.onTrace, { type: "turn.error", message });
      }
      throw err;
    } finally {
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
    }
  }
}

function buildSdkTool(
  sdk: typeof import("@openai/agents"),
  agentTool: AgentTool,
  pipeline: MiddlewarePipeline,
  ctx: AgentRunContext,
  onTrace?: AgentRunInput["onTrace"],
) {
  return sdk.tool({
    name: agentTool.name,
    description: agentTool.description,
    parameters: agentTool.inputSchema as never,
    strict: false,
    async execute(args: unknown) {
      const toolInput = (args ?? {}) as Record<string, unknown>;
      const call: ToolCall = {
        id: agentTool.name,
        name: agentTool.name,
        arguments: toolInput,
      };
      let coreRan = false;
      const core = async (): Promise<ToolOutcome> => {
        coreRan = true;
        try {
          const result = await agentTool.handler(toolInput);
          if (onTrace) {
            emitTrace(onTrace, {
              type: "tool_result",
              callId: agentTool.name,
              name: agentTool.name,
              outputPreview: previewToolOutput(result),
            });
          }
          return {
            content: typeof result === "string" ? result : JSON.stringify(result),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (onTrace) {
            emitTrace(onTrace, {
              type: "tool_call.failed",
              callId: agentTool.name,
              name: agentTool.name,
              error: message,
            });
          }
          return { content: JSON.stringify({ error: message, ok: false }), isError: true };
        }
      };
      const outcome = await pipeline.toolCall(ctx, call, core);
      // A beforeToolCall middleware vetoed (e.g. budget): core never ran.
      if (!coreRan && outcome.isError && onTrace) {
        emitTrace(onTrace, {
          type: "tool_call.failed",
          callId: agentTool.name,
          name: agentTool.name,
          error: outcome.content,
        });
      }
      // The OpenAI Agents SDK expects the tool to return the string the model
      // sees; on a veto that's the middleware's reason.
      return outcome.content;
    },
  });
}

function buildHandoffAgent(
  sdk: typeof import("@openai/agents"),
  sub: SubagentRef,
  parentModel: string,
  parentSkills: LoadedSkill[],
) {
  const base = `You are ${sub.name}, a ${sub.roleKey}. ${sub.description}\n\nCarry out the task delegated to you and return a concise summary.`;
  return new sdk.Agent({
    name: sub.name,
    instructions: appendSkillsToPrompt(base, parentSkills),
    model: parentModel,
  });
}

/**
 * Build an OpenAI Agents SDK MCP server from our AgentMcpServer shape.
 * The SDK speaks Streamable HTTP MCP natively — it connects, lists
 * remote tools, registers them on the agent, and routes tool calls
 * through `callTool`. Auth headers (when set) ride on `requestInit`.
 *
 * `cacheToolsList: true` is on by default — tools rarely change at
 * runtime and the cache cuts a connect-per-call to once-per-server.
 */
function buildSdkMcpServer(
  sdk: typeof import("@openai/agents"),
  server: AgentMcpServer,
) {
  const requestInit = server.authorization
    ? { headers: { Authorization: server.authorization } }
    : undefined;
  return new sdk.MCPServerStreamableHttp({
    name: server.name,
    url: server.url,
    cacheToolsList: true,
    requestInit,
  });
}
