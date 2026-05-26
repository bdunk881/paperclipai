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
import type {
  AgentBackend,
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
      const sdkTools = (input.tools ?? []).map((t) =>
        buildSdkTool(sdk, t, input.onTrace),
      );

      const handoffAgents = (input.subagents ?? []).map((sub) =>
        buildHandoffAgent(sdk, sub, binding.model),
      );

      const agent = new sdk.Agent({
        name: input.agentName,
        instructions: input.systemPrompt,
        model: binding.model,
        tools: sdkTools,
        handoffs: handoffAgents,
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
  onTrace?: AgentRunInput["onTrace"],
) {
  return sdk.tool({
    name: agentTool.name,
    description: agentTool.description,
    parameters: agentTool.inputSchema as never,
    strict: false,
    async execute(args: unknown) {
      try {
        const result = await agentTool.handler(
          (args ?? {}) as Record<string, unknown>,
        );
        if (onTrace) {
          emitTrace(onTrace, {
            type: "tool_result",
            callId: agentTool.name,
            name: agentTool.name,
            outputPreview: previewToolOutput(result),
          });
        }
        return typeof result === "string" ? result : JSON.stringify(result);
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
        return JSON.stringify({ error: message, ok: false });
      }
    },
  });
}

function buildHandoffAgent(
  sdk: typeof import("@openai/agents"),
  sub: SubagentRef,
  parentModel: string,
) {
  return new sdk.Agent({
    name: sub.name,
    instructions: `You are ${sub.name}, a ${sub.roleKey}. ${sub.description}\n\nCarry out the task delegated to you and return a concise summary.`,
    model: parentModel,
  });
}
