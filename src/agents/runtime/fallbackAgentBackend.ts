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
import { resolveSkills, type LoadedSkill } from "../../skills/skillsLoader";
import { executeToolCalls } from "./executeToolCalls";
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
    const tools = input.tools ?? [];
    const wrappedTools = wrapWithHooks(tools, input);
    const toolsByName = new Map(wrappedTools.map((t) => [t.name, t]));
    const toolSpecs: ToolSpec[] = wrappedTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }));
    const maxIterations = input.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    const loadedSkills = resolveSkills(input.skills ?? []);
    const system = buildSystemWithSkills(input.systemPrompt, loadedSkills);

    if (input.permissionMode === "plan") {
      // Plan mode: don't run tools — produce a plan and stop. The fallback
      // backend doesn't have a native plan mode like the Claude SDK, so we
      // inject an instruction into the system prompt and drop the tools.
      return runPlanMode(input, binding, adapter, system);
    }

    const messages: NormalizedMessage[] = [
      { role: "user", content: input.userPrompt },
    ];

    let cumulativeInput = 0;
    let cumulativeOutput = 0;
    let cumulativeCached = 0;

    const addUsage = (u: NormalizedUsage) => {
      cumulativeInput += u.inputTokens;
      cumulativeOutput += u.outputTokens;
      cumulativeCached += u.cachedInputTokens ?? 0;
    };

    const buildRequest = (msgs: NormalizedMessage[], includeTools: boolean): NormalizedRequest => ({
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
        const request = buildRequest(messages, true);
        response = adapter.invokeStream
          ? await adapter.invokeStream(request)
          : await adapter.invoke(request);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (input.onTrace) emitTrace(input.onTrace, { type: "turn.error", message });
        throw err;
      }

      addUsage(response.usage);
      messages.push({
        role: "assistant",
        content: response.content || undefined,
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      });

      if (response.toolCalls.length === 0) {
        const usage = {
          promptTokens: cumulativeInput,
          completionTokens: cumulativeOutput,
          cachedPromptTokens: cumulativeCached > 0 ? cumulativeCached : undefined,
        };
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
      });
      messages.push({ role: "tool", toolResults });
    }

    // Cap exceeded: one final summarize-only turn.
    try {
      const wrapMessages: NormalizedMessage[] = [
        ...messages,
        { role: "user", content: MAX_ITER_SUMMARY_PROMPT },
      ];
      const wrap = await (adapter.invokeStream ?? adapter.invoke).call(
        adapter,
        buildRequest(wrapMessages, false),
      );
      addUsage(wrap.usage);
      const text = (wrap.content || "[interrupted: max iterations]") + MAX_ITER_SUFFIX;
      const usage = {
        promptTokens: cumulativeInput,
        completionTokens: cumulativeOutput,
        cachedPromptTokens: cumulativeCached > 0 ? cumulativeCached : undefined,
      };
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
      const usage = {
        promptTokens: cumulativeInput,
        completionTokens: cumulativeOutput,
        cachedPromptTokens: cumulativeCached > 0 ? cumulativeCached : undefined,
      };
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
 * On backends without native Claude Skills support, splice each loaded
 * skill's full SKILL.md body into the system prompt under a "SKILLS
 * AVAILABLE" section. The Claude SDK backend uses native skills wiring;
 * here we just stuff the markdown into the prompt so the model sees the
 * same content regardless of provider.
 */
function buildSystemWithSkills(base: string, skills: LoadedSkill[]): string {
  if (skills.length === 0) return base;
  const sections = skills
    .map((s) => `### ${s.name}\n${s.description}\n\n${s.body}`)
    .join("\n\n---\n\n");
  return `${base}\n\n# SKILLS AVAILABLE\n\n${sections}`;
}

/**
 * Wrap each AgentTool with pre/post-tool hooks. Returning a tool whose
 * handler short-circuits when `preToolUse` returns `{ continue: false }`
 * keeps the loop semantics identical between backends — the wrapped
 * handler either throws (caught by executeToolCalls and surfaced as an
 * isError tool_result) or returns the original result.
 */
function wrapWithHooks(tools: AgentTool[], input: AgentRunInput): AgentTool[] {
  if (!input.hooks?.preToolUse && !input.hooks?.postToolUse) return tools;
  return tools.map((t) => ({
    ...t,
    handler: async (toolInput: Record<string, unknown>) => {
      if (input.hooks?.preToolUse) {
        try {
          const decision = await input.hooks.preToolUse({
            toolName: t.name,
            toolInput,
          });
          if (decision && decision.continue === false) {
            throw new Error(
              decision.reason ?? "Pre-tool-use hook blocked this call.",
            );
          }
        } catch (err) {
          // PreToolUse hooks may throw; propagate to executeToolCalls
          // which marks the tool_result as isError.
          throw err;
        }
      }
      let result: unknown;
      try {
        result = await t.handler(toolInput);
      } catch (err) {
        if (input.hooks?.postToolUse) {
          try {
            await input.hooks.postToolUse({
              toolName: t.name,
              toolInput,
              result: null,
              error: (err as Error).message,
            });
          } catch (hookErr) {
            console.warn(
              `[fallbackAgentBackend] postToolUse hook threw: ${(hookErr as Error).message}`,
            );
          }
        }
        throw err;
      }
      if (input.hooks?.postToolUse) {
        try {
          await input.hooks.postToolUse({ toolName: t.name, toolInput, result });
        } catch (err) {
          console.warn(
            `[fallbackAgentBackend] postToolUse hook threw: ${(err as Error).message}`,
          );
        }
      }
      return result;
    },
  }));
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
