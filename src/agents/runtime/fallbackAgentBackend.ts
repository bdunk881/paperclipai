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
    const toolsByName = new Map(tools.map((t) => [t.name, t]));
    const toolSpecs: ToolSpec[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }));
    const maxIterations = input.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    const system = buildSystemWithSkills(input.systemPrompt, input.skills);

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
 * On backends without native Claude Skills support, fold any requested
 * skill keys into the system prompt as a "SKILLS AVAILABLE" section. The
 * skill content itself is editor-authored in the repo's `skills/` folder
 * (Phase 2) and loaded by a yet-to-build skills registry. Until that lands
 * we surface just the keys so the model knows what it has been hired for.
 */
function buildSystemWithSkills(base: string, skills?: string[]): string {
  if (!skills || skills.length === 0) return base;
  return `${base}\n\nSKILLS AVAILABLE:\n${skills.map((s) => `- ${s}`).join("\n")}`;
}
