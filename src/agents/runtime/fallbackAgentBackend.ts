/**
 * FallbackAgentBackend — generic multi-turn agent loop that works against
 * any provider that has a `ProviderAdapter` registered. The Anthropic and
 * OpenAI native SDK backends pre-empt this for their respective providers;
 * everything else (Bedrock, Vertex AI, Gemini, Mistral, Cohere, the
 * OpenAI-compatible long-tail) lands here.
 *
 * Loop shape (deliberately identical to the legacy `runAnthropicToolLoop`
 * the project shipped pre-SDK so behavior is unchanged for callers):
 *   1. Send the normalized request + tool defs.
 *   2. If the response has tool calls, execute them and append to history.
 *   3. Otherwise return the final text + cumulative usage.
 *   4. Cap at maxToolIterations; on cap, ask the model to summarize without
 *      tools so the caller always gets readable text.
 *
 * HEL-621: cross-cutting concerns are no longer wired inline. The model call
 * and every tool call are routed through a `MiddlewarePipeline` built from the
 * caller's `hooks` (and, later, explicit middleware). This is the only backend
 * where model-phase middleware (compaction / retry / fallback / caching) can
 * run; the SDK backends own their own loop. With no middleware the pipeline is
 * a transparent pass-through, so the default path is byte-for-byte unchanged.
 */

import { getProviderAdapter } from "../../llmConfig/adapters";
import type {
  NormalizedMessage,
  NormalizedRequest,
  NormalizedResponse,
  NormalizedUsage,
  ToolSpec,
} from "../../llmConfig/adapters/types";
import type { AgentTool } from "../../engine/llmProviders/types";
import { emitTrace } from "../../engine/agentTrace/emitCallbacks";
import { appendSkillsToPrompt, resolveSkills } from "../../skills/skillsLoader";
import { buildMcpToolBridge } from "./mcpToolBridge";
import { executeToolCalls } from "./executeToolCalls";
import { buildPipeline, type MiddlewarePipeline } from "./middleware/pipeline";
import type { AgentRunContext } from "./middleware/types";
import type {
  AgentBackend,
  AgentRunInput,
  AgentRunResult,
  ResolvedModelBinding,
} from "./types";

const DEFAULT_MAX_TOOL_ITERATIONS = 8;
const MAX_ITER_SUMMARY_PROMPT =
  "Maximum tool iterations reached. Summarize what you accomplished and what's still pending in 1-3 sentences. Do not call any tools.";
const MAX_ITER_SUFFIX = "\n\n[interrupted: max iterations]";

export class FallbackAgentBackend implements AgentBackend {
  readonly name = "fallback" as const;

  async run(
    input: AgentRunInput,
    binding: ResolvedModelBinding,
  ): Promise<AgentRunResult> {
    const adapter = getProviderAdapter(binding.provider);

    // External MCP bridge: for every MCP server the caller passed,
    // connect, list tools, and merge them into the agent's tool set.
    // The Claude SDK and OpenAI Agents SDK do this natively; here we
    // do it manually so customers on Gemini / Mistral / Bedrock /
    // Vertex don't lose their connected MCP servers when their
    // workspace falls through to this backend.
    const bridge = await buildMcpToolBridge(input.mcpServers ?? []);
    for (const failure of bridge.failures) {
      console.warn(
        `[fallbackAgentBackend] MCP server "${failure.serverName}" unreachable: ${failure.error}`,
      );
    }

    const callerTools = input.tools ?? [];
    const tools = [...callerTools, ...bridge.tools];
    const toolsByName = new Map(tools.map((t) => [t.name, t]));
    const toolSpecs: ToolSpec[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }));
    const maxIterations = input.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    const loadedSkills = resolveSkills(input.skills ?? []);
    const system = appendSkillsToPrompt(input.systemPrompt, loadedSkills);
    const pipeline = buildPipeline(input.hooks, input.middleware);

    try {
      return await this.runInner({
        input,
        binding,
        adapter,
        system,
        toolsByName,
        toolSpecs,
        maxIterations,
        pipeline,
      });
    } finally {
      await bridge.close();
    }
  }

  private async runInner(args: {
    input: AgentRunInput;
    binding: ResolvedModelBinding;
    adapter: ReturnType<typeof getProviderAdapter>;
    system: string;
    toolsByName: Map<string, AgentTool>;
    toolSpecs: ToolSpec[];
    maxIterations: number;
    pipeline: MiddlewarePipeline;
  }): Promise<AgentRunResult> {
    const { input, binding, adapter, system, toolsByName, toolSpecs, maxIterations, pipeline } =
      args;
    if (input.permissionMode === "plan") {
      // Plan mode: don't run tools — produce a plan and stop. The fallback
      // backend doesn't have a native plan mode like the Claude SDK, so we
      // inject an instruction into the system prompt and drop the tools.
      return runPlanMode(input, binding, adapter, system);
    }

    const ctx: AgentRunContext = {
      run: input,
      binding,
      messages: [{ role: "user", content: input.userPrompt }],
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      state: new Map(),
      backend: this.name,
    };

    const addUsage = (u: NormalizedUsage) => {
      ctx.usage.inputTokens += u.inputTokens;
      ctx.usage.outputTokens += u.outputTokens;
      ctx.usage.cachedInputTokens =
        (ctx.usage.cachedInputTokens ?? 0) + (u.cachedInputTokens ?? 0);
    };

    const finalUsage = () => ({
      promptTokens: ctx.usage.inputTokens,
      completionTokens: ctx.usage.outputTokens,
      cachedPromptTokens:
        (ctx.usage.cachedInputTokens ?? 0) > 0 ? ctx.usage.cachedInputTokens : undefined,
    });

    const buildRequest = (
      msgs: NormalizedMessage[],
      includeTools: boolean,
    ): NormalizedRequest => ({
      provider: binding.provider,
      model: binding.model,
      apiKey: binding.apiKey,
      providerOptions: binding.providerOptions,
      messages: msgs,
      system,
      tools: includeTools && toolSpecs.length > 0 ? toolSpecs : undefined,
      onTrace: input.onTrace,
    });

    if (input.onTrace) {
      emitTrace(input.onTrace, { type: "turn.started", at: new Date().toISOString() });
    }

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (input.onTrace) emitTrace(input.onTrace, { type: "iteration.started", iteration });

      let response: NormalizedResponse;
      try {
        response = await pipeline.modelCall(ctx, () => {
          const request = buildRequest(ctx.messages, true);
          return adapter.invokeStream
            ? adapter.invokeStream(request)
            : adapter.invoke(request);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (input.onTrace) emitTrace(input.onTrace, { type: "turn.error", message });
        throw err;
      }

      addUsage(response.usage);
      ctx.messages.push({
        role: "assistant",
        content: response.content || undefined,
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      });

      if (response.toolCalls.length === 0) {
        const usage = finalUsage();
        if (input.onTrace) {
          emitTrace(input.onTrace, {
            type: "turn.completed",
            text: response.content,
            usage,
          });
        }
        return {
          text: response.content,
          usage,
          provider: binding.provider,
          model: binding.model,
          backend: this.name,
        };
      }

      const toolResults = await executeToolCalls({
        toolCalls: response.toolCalls,
        toolsByName,
        onTrace: input.onTrace,
        runToolCall: (call, core) => pipeline.toolCall(ctx, call, core),
      });
      ctx.messages.push({ role: "tool", toolResults });
    }

    // Cap exceeded: one final summarize-only turn.
    try {
      const wrapMessages: NormalizedMessage[] = [
        ...ctx.messages,
        { role: "user", content: MAX_ITER_SUMMARY_PROMPT },
      ];
      const wrap = await (adapter.invokeStream ?? adapter.invoke).call(
        adapter,
        buildRequest(wrapMessages, false),
      );
      addUsage(wrap.usage);
      const text = (wrap.content || "[interrupted: max iterations]") + MAX_ITER_SUFFIX;
      const usage = finalUsage();
      if (input.onTrace) emitTrace(input.onTrace, { type: "turn.completed", text, usage });
      return {
        text,
        usage,
        provider: binding.provider,
        model: binding.model,
        backend: this.name,
      };
    } catch {
      const text = "[interrupted: max iterations]";
      const usage = finalUsage();
      if (input.onTrace) emitTrace(input.onTrace, { type: "turn.completed", text, usage });
      return {
        text,
        usage,
        provider: binding.provider,
        model: binding.model,
        backend: this.name,
      };
    }
  }
}

/**
 * Plan-mode short-circuit. Asks the model to produce a plan without
 * executing any tools, then returns. The caller (AutoFlow's approvals
 * subsystem) decides whether to file an approval ticket and re-run with
 * `permissionMode: "auto"` after a human signs off.
 */
async function runPlanMode(
  input: AgentRunInput,
  binding: ResolvedModelBinding,
  adapter: ReturnType<typeof getProviderAdapter>,
  system: string,
): Promise<AgentRunResult> {
  const planSystem =
    `${system}\n\n# PLAN MODE\n\nDo NOT execute any tools. Produce a numbered plan of steps you would take, with the first step being whichever tool you would call first. Stop after the plan. A human will review and decide whether to approve execution.`;
  const messages: NormalizedMessage[] = [
    { role: "user", content: input.userPrompt },
  ];
  if (input.onTrace) {
    emitTrace(input.onTrace, { type: "turn.started", at: new Date().toISOString() });
  }
  const response = await (adapter.invokeStream ?? adapter.invoke).call(adapter, {
    provider: binding.provider,
    model: binding.model,
    apiKey: binding.apiKey,
    providerOptions: binding.providerOptions,
    messages,
    system: planSystem,
    tools: undefined,
    onTrace: input.onTrace,
  });
  const usage = {
    promptTokens: response.usage.inputTokens,
    completionTokens: response.usage.outputTokens,
    cachedPromptTokens:
      (response.usage.cachedInputTokens ?? 0) > 0
        ? response.usage.cachedInputTokens
        : undefined,
  };
  if (input.onTrace) {
    emitTrace(input.onTrace, { type: "turn.completed", text: response.content, usage });
  }
  return {
    text: response.content,
    usage,
    provider: binding.provider,
    model: binding.model,
    backend: "fallback",
  };
}
