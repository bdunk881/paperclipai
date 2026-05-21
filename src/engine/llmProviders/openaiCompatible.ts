import OpenAI from "openai";
import type { AgentTraceCallback } from "../agentTrace/types";
import { emitTrace, resolveTraceCallback } from "../agentTrace/emitCallbacks";
import { previewToolOutput } from "../agentTrace/redact";
import {
  createOpenAIStreamAccumulators,
  mapOpenAIStreamChunk,
  resetOpenAIToolCallAccum,
} from "./openaiStream";
import {
  AgentTool,
  DEFAULT_LLM_REQUEST_TIMEOUT_MS,
  LLMProvider,
  LLMProviderConfig,
  LLMResponse,
  ResponseFormat,
} from "./types";

const DEFAULT_MAX_TOOL_ITERATIONS = 8;

interface OpenAICompatibleOptions {
  label: string;
  baseURL?: string;
  baseURLEnvVar?: string;
  resolveBaseURL?: (config: LLMProviderConfig) => string | undefined;
  resolveModel?: (config: LLMProviderConfig) => string;
}

/**
 * Convert our provider-agnostic ResponseFormat into the OpenAI
 * Chat Completions API's `response_format` shape. Returns undefined
 * when the caller didn't ask for structured output, in which case
 * we let the model choose.
 */
function toOpenAIResponseFormat(
  responseFormat: ResponseFormat | undefined,
): OpenAI.Chat.ChatCompletionCreateParams["response_format"] | undefined {
  if (!responseFormat || responseFormat.type === "text") return undefined;
  if (responseFormat.type === "json_object") {
    return { type: "json_object" };
  }
  // json_schema — every modern OpenAI-compat endpoint (OpenAI, Groq,
  // Fireworks, xAI, DeepSeek, OpenCode Zen) accepts this shape. Older
  // ones (Ollama on certain versions, perplexity for non-sonar models)
  // may 400; the caller's outer try/catch + Tier 1 extractor pickup
  // covers that case.
  return {
    type: "json_schema",
    json_schema: {
      name: responseFormat.name ?? "response",
      schema: responseFormat.schema,
      strict: true,
    },
  };
}

export function createOpenAICompatibleProvider(
  config: LLMProviderConfig,
  options: OpenAICompatibleOptions
): LLMProvider {
  const resolvedBaseURL =
    options.resolveBaseURL?.(config) ??
    options.baseURL ??
    (options.baseURLEnvVar ? process.env[options.baseURLEnvVar] : undefined);
  const resolvedApiKey = config.apiKey ?? config.credentials?.apiKey;
  const resolvedModel = options.resolveModel?.(config) ?? config.model;

  if (options.baseURLEnvVar && !resolvedBaseURL) {
    throw new Error(
      `${options.label} API error: set ${options.baseURLEnvVar} before using ${config.provider}`
    );
  }
  if (!resolvedApiKey) {
    throw new Error(
      `${options.label} API error: missing API key credentials for ${config.provider}`
    );
  }

  // Explicit per-request timeout — see DEFAULT_LLM_REQUEST_TIMEOUT_MS.
  // Covers every OpenAI-compat provider (OpenAI, Groq, Fireworks,
  // Together, xAI, DeepSeek, Perplexity, Ollama, LocalAI, OpenCode Zen).
  const timeoutMs = config.requestTimeoutMs ?? DEFAULT_LLM_REQUEST_TIMEOUT_MS;

  const client = new OpenAI({
    apiKey: resolvedApiKey,
    timeout: timeoutMs,
    ...(resolvedBaseURL ? { baseURL: resolvedBaseURL } : {}),
  });

  const responseFormat = toOpenAIResponseFormat(config.responseFormat);

  /**
   * HEL-145: Build the messages array, optionally prefixed with a
   * system-role message. Pulled into a helper so every code path
   * (streaming, tool loop, single-call) builds it the same way.
   *
   * OpenAI's prompt cache is automatic for prefixes > ~1024 tokens
   * with no per-call opt-in — sending the system prompt as a
   * dedicated message is all that's required for the cache to kick in
   * on repeat calls within the TTL window. The `cacheSystemPrompt`
   * flag from LLMProviderConfig is accepted for cross-provider API
   * consistency but is a no-op here.
   */
  function buildMessages(
    userPrompt: string,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (config.systemPrompt) {
      messages.push({ role: "system", content: config.systemPrompt });
    }
    messages.push({ role: "user", content: userPrompt });
    return messages;
  }

  return async (prompt: string): Promise<LLMResponse> => {
    // Agentic tool-loop path (PR 3). Mirrors the Anthropic provider
    // shape so callers can swap providers without changing call
    // sites. JSON-mode (responseFormat) is intentionally not mixed
    // with the loop — they use the same tool primitive in opposite
    // ways.
    const onTrace = resolveTraceCallback(config);

    if (config.tools && config.tools.length > 0 && !responseFormat) {
      if (onTrace) {
        return runOpenAIToolLoopStream({
          client,
          model: resolvedModel,
          label: options.label,
          prompt,
          tools: config.tools,
          maxIterations: config.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS,
          systemPrompt: config.systemPrompt,
          maxOutputTokens: config.maxOutputTokens,
          onTrace,
          buildMessages,
        });
      }
      return runOpenAIToolLoop({
        client,
        model: resolvedModel,
        label: options.label,
        prompt,
        tools: config.tools,
        maxIterations: config.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS,
        systemPrompt: config.systemPrompt,
        maxOutputTokens: config.maxOutputTokens,
      });
    }

    // Streaming path: caller supplied onTrace / onText. Use the
    // chat-completions stream and accumulate text deltas across
    // chunks. Skipped when JSON-mode is in effect — structured
    // responses arrive as a single content blob, streaming the
    // delta-by-delta JSON isn't useful for the presence pill.
    if (onTrace && !responseFormat) {
      const acc = createOpenAIStreamAccumulators();
      let promptTokens = 0;
      let completionTokens = 0;
      let cachedPromptTokens: number | undefined;
      try {
        const stream = await client.chat.completions.create({
          model: resolvedModel,
          messages: buildMessages(prompt),
          stream: true,
          stream_options: { include_usage: true },
          ...(typeof config.maxOutputTokens === "number"
            ? { max_tokens: config.maxOutputTokens }
            : {}),
        });
        for await (const chunk of stream) {
          mapOpenAIStreamChunk(chunk, onTrace, acc);
          if (chunk.usage) {
            const buckets = extractOpenAICacheBucket(chunk.usage);
            promptTokens = buckets.promptTokens;
            completionTokens = chunk.usage.completion_tokens;
            if (buckets.cachedPromptTokens !== undefined) {
              cachedPromptTokens = buckets.cachedPromptTokens;
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`${options.label} API error: ${msg}`);
      }
      const usage = { promptTokens, completionTokens, cachedPromptTokens };
      emitTrace(onTrace, {
        type: "turn.completed",
        text: acc.assistantText,
        usage,
      });
      return {
        text: acc.assistantText,
        usage,
      };
    }

    let response;
    try {
      response = await client.chat.completions.create({
        model: resolvedModel,
        messages: buildMessages(prompt),
        ...(responseFormat ? { response_format: responseFormat } : {}),
        ...(typeof config.maxOutputTokens === "number"
          ? { max_tokens: config.maxOutputTokens }
          : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${options.label} API error: ${msg}`);
    }

    const text = response.choices[0]?.message?.content ?? "";
    const usage = response.usage
      ? (() => {
          const buckets = extractOpenAICacheBucket(response.usage!);
          return {
            promptTokens: buckets.promptTokens,
            completionTokens: response.usage!.completion_tokens,
            cachedPromptTokens: buckets.cachedPromptTokens,
          };
        })()
      : undefined;

    return { text, usage };
  };
}

/**
 * HEL-145 followup (Codex review iteration 2 on PR #898): the revised
 * contract is that `promptTokens` is the TOTAL input count (matches
 * legacy semantics), and `cachedPromptTokens` is the cached SUB-bucket.
 *
 * OpenAI already returns `prompt_tokens` as the total (cached portion
 * is included), so we pass it through unchanged. The cache sub-bucket
 * comes from `prompt_tokens_details.cached_tokens` when present.
 *
 * This keeps every existing cost-logger correct on cache hits — they
 * read `promptTokens` and continue to see the full input count.
 * Cache-aware billing can subtract `cachedPromptTokens` to apply the
 * discounted rate.
 */
function extractOpenAICacheBucket(
  usage: OpenAI.Completions.CompletionUsage,
): { promptTokens: number; cachedPromptTokens: number | undefined } {
  const details = (usage as { prompt_tokens_details?: { cached_tokens?: number | null } })
    .prompt_tokens_details;
  const cached =
    details && typeof details.cached_tokens === "number" && details.cached_tokens > 0
      ? details.cached_tokens
      : undefined;
  return {
    promptTokens: usage.prompt_tokens,
    cachedPromptTokens: cached,
  };
}

/**
 * PR 3: OpenAI-compatible agentic tool loop.
 *
 * Mirrors `runAnthropicToolLoop` in anthropic.ts but speaks the
 * Chat Completions API: assistant turns carry `tool_calls`, tool
 * results come back as `role: "tool"` messages with the matching
 * `tool_call_id`. Loop terminates on `finish_reason !== "tool_calls"`
 * or when maxIterations fires.
 *
 * Works against every OpenAI-compatible endpoint that supports
 * tools (OpenAI, Groq, Fireworks, Together, xAI, Perplexity sonar-
 * pro, Mistral via openai-compat — the last one is double-covered).
 * Endpoints without tools support (older Ollama, LocalAI) will 400;
 * the caller's catch surfaces the underlying provider error.
 */
async function runOpenAIToolLoopStream(args: {
  client: OpenAI;
  model: string;
  label: string;
  prompt: string;
  tools: AgentTool[];
  maxIterations: number;
  systemPrompt?: string;
  maxOutputTokens?: number;
  onTrace: AgentTraceCallback;
  buildMessages: (
    userPrompt: string,
  ) => OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}): Promise<LLMResponse> {
  const toolsByName = new Map(args.tools.map((t) => [t.name, t]));
  const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = args.tools.map(
    (t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }),
  );

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
    args.buildMessages(args.prompt);

  let cumulativePromptTokens = 0;
  let cumulativeCompletionTokens = 0;
  let cumulativeCachedTokens = 0;

  const finishUsage = (): LLMResponse["usage"] => ({
    promptTokens: cumulativePromptTokens,
    completionTokens: cumulativeCompletionTokens,
    cachedPromptTokens:
      cumulativeCachedTokens > 0 ? cumulativeCachedTokens : undefined,
  });

  for (let iteration = 0; iteration < args.maxIterations; iteration++) {
    emitTrace(args.onTrace, { type: "iteration.started", iteration });
    const acc = createOpenAIStreamAccumulators();
    resetOpenAIToolCallAccum(acc);
    let assistantMessage: OpenAI.Chat.Completions.ChatCompletionMessage | undefined;
    try {
      const stream = await args.client.chat.completions.create({
        model: args.model,
        messages,
        tools: openaiTools,
        stream: true,
        stream_options: { include_usage: true },
        ...(typeof args.maxOutputTokens === "number"
          ? { max_tokens: args.maxOutputTokens }
          : {}),
      });
      for await (const chunk of stream) {
        mapOpenAIStreamChunk(chunk, args.onTrace, acc);
        if (chunk.usage) {
          const buckets = extractOpenAICacheBucket(chunk.usage);
          cumulativePromptTokens += buckets.promptTokens;
          cumulativeCompletionTokens += chunk.usage.completion_tokens;
          if (buckets.cachedPromptTokens !== undefined) {
            cumulativeCachedTokens += buckets.cachedPromptTokens;
          }
        }
      }
      // Reconstruct assistant message from accumulated stream state.
      const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
      for (const entry of acc.toolCalls.values()) {
        toolCalls.push({
          id: entry.id,
          type: "function",
          function: {
            name: entry.name,
            arguments: entry.argumentsJson,
          },
        });
      }
      assistantMessage = {
        role: "assistant",
        content: acc.assistantText || null,
        refusal: null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emitTrace(args.onTrace, { type: "turn.error", message: msg });
      throw new Error(`${args.label} API error: ${msg}`);
    }

    if (!assistantMessage) {
      const usage = finishUsage()!;
      emitTrace(args.onTrace, { type: "turn.completed", text: "", usage });
      return { text: "", usage };
    }

    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls?.length) {
      const text = assistantMessage.content ?? acc.assistantText;
      const usage = finishUsage()!;
      emitTrace(args.onTrace, { type: "turn.completed", text, usage });
      return { text, usage };
    }

    const toolMessages = await Promise.all(
      assistantMessage.tool_calls.map(async (call) => {
        if (call.type !== "function") {
          return {
            role: "tool" as const,
            tool_call_id: call.id,
            content: `Tool calls of type "${call.type}" are not supported.`,
          };
        }
        const tool = toolsByName.get(call.function.name);
        if (!tool) {
          emitTrace(args.onTrace, {
            type: "tool_call.failed",
            callId: call.id,
            name: call.function.name,
            error: `Tool "${call.function.name}" is not registered.`,
          });
          return {
            role: "tool" as const,
            tool_call_id: call.id,
            content: `Tool "${call.function.name}" is not registered. Try another approach.`,
          };
        }
        try {
          const input = call.function.arguments
            ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
            : {};
          const result = await tool.handler(input);
          emitTrace(args.onTrace, {
            type: "tool_result",
            callId: call.id,
            name: call.function.name,
            outputPreview: previewToolOutput(result),
          });
          return {
            role: "tool" as const,
            tool_call_id: call.id,
            content: typeof result === "string" ? result : JSON.stringify(result),
          };
        } catch (handlerErr) {
          const msg =
            handlerErr instanceof Error ? handlerErr.message : String(handlerErr);
          emitTrace(args.onTrace, {
            type: "tool_call.failed",
            callId: call.id,
            name: call.function.name,
            error: msg,
          });
          return {
            role: "tool" as const,
            tool_call_id: call.id,
            content: `Tool "${call.function.name}" failed: ${msg}`,
          };
        }
      }),
    );

    messages.push(...toolMessages);
  }

  try {
    const finalTurn = await args.client.chat.completions.create({
      model: args.model,
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Maximum tool iterations reached. Summarize what you accomplished and what's still pending in 1-3 sentences. Do not call any tools.",
        },
      ],
      max_tokens:
        typeof args.maxOutputTokens === "number" ? args.maxOutputTokens : 512,
    });
    if (finalTurn.usage) {
      const buckets = extractOpenAICacheBucket(finalTurn.usage);
      cumulativePromptTokens += buckets.promptTokens;
      cumulativeCompletionTokens += finalTurn.usage.completion_tokens;
      if (buckets.cachedPromptTokens !== undefined) {
        cumulativeCachedTokens += buckets.cachedPromptTokens;
      }
    }
    const text = finalTurn.choices[0]?.message?.content ?? "";
    const usage = finishUsage()!;
    const fullText = `${text}\n\n[interrupted: max iterations]`;
    emitTrace(args.onTrace, { type: "turn.completed", text: fullText, usage });
    return { text: fullText, usage };
  } catch {
    const usage = finishUsage()!;
    emitTrace(args.onTrace, {
      type: "turn.completed",
      text: "[interrupted: max iterations]",
      usage,
    });
    return { text: "[interrupted: max iterations]", usage };
  }
}

async function runOpenAIToolLoop(args: {
  client: OpenAI;
  model: string;
  label: string;
  prompt: string;
  tools: AgentTool[];
  maxIterations: number;
  systemPrompt?: string;
  /** HEL-147: per-call output cap. Defaults to provider's own default. */
  maxOutputTokens?: number;
}): Promise<LLMResponse> {
  const toolsByName = new Map(args.tools.map((t) => [t.name, t]));
  const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = args.tools.map(
    (t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }),
  );

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (args.systemPrompt) {
    messages.push({ role: "system", content: args.systemPrompt });
  }
  messages.push({ role: "user", content: args.prompt });

  let cumulativePromptTokens = 0;
  let cumulativeCompletionTokens = 0;
  let cumulativeCachedTokens = 0;

  for (let iteration = 0; iteration < args.maxIterations; iteration++) {
    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await args.client.chat.completions.create({
        model: args.model,
        messages,
        tools: openaiTools,
        ...(typeof args.maxOutputTokens === "number"
          ? { max_tokens: args.maxOutputTokens }
          : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${args.label} API error: ${msg}`);
    }

    if (response.usage) {
      // HEL-145 contract: promptTokens is TOTAL input; cachedPromptTokens
      // is the cached sub-bucket. Preserves legacy spend-logger
      // semantics on cache hits.
      const buckets = extractOpenAICacheBucket(response.usage);
      cumulativePromptTokens += buckets.promptTokens;
      cumulativeCompletionTokens += response.usage.completion_tokens;
      if (buckets.cachedPromptTokens !== undefined) {
        cumulativeCachedTokens += buckets.cachedPromptTokens;
      }
    }

    const choice = response.choices[0];
    const assistantMessage = choice?.message;
    if (!assistantMessage) {
      return {
        text: "",
        usage: {
          promptTokens: cumulativePromptTokens,
          completionTokens: cumulativeCompletionTokens,
          cachedPromptTokens:
            cumulativeCachedTokens > 0 ? cumulativeCachedTokens : undefined,
        },
      };
    }

    messages.push(assistantMessage);

    if (choice.finish_reason !== "tool_calls" || !assistantMessage.tool_calls) {
      return {
        text: assistantMessage.content ?? "",
        usage: {
          promptTokens: cumulativePromptTokens,
          completionTokens: cumulativeCompletionTokens,
          cachedPromptTokens:
            cumulativeCachedTokens > 0 ? cumulativeCachedTokens : undefined,
        },
      };
    }

    // Execute every tool_call in parallel. The Chat Completions API
    // wants ONE `role: "tool"` message per tool_call_id, in order, so
    // we map results back by id after the await.
    const toolMessages = await Promise.all(
      assistantMessage.tool_calls.map(async (call) => {
        if (call.type !== "function") {
          return {
            role: "tool" as const,
            tool_call_id: call.id,
            content: `Tool calls of type "${call.type}" are not supported.`,
          };
        }
        const tool = toolsByName.get(call.function.name);
        if (!tool) {
          return {
            role: "tool" as const,
            tool_call_id: call.id,
            content: `Tool "${call.function.name}" is not registered. Try another approach.`,
          };
        }
        try {
          const input = call.function.arguments
            ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
            : {};
          const result = await tool.handler(input);
          return {
            role: "tool" as const,
            tool_call_id: call.id,
            content:
              typeof result === "string" ? result : JSON.stringify(result),
          };
        } catch (handlerErr) {
          const msg =
            handlerErr instanceof Error ? handlerErr.message : String(handlerErr);
          return {
            role: "tool" as const,
            tool_call_id: call.id,
            content: `Tool "${call.function.name}" failed: ${msg}`,
          };
        }
      }),
    );

    messages.push(...toolMessages);
  }

  // Iteration cap: ask for a wrap-up turn without tools.
  try {
    const finalTurn = await args.client.chat.completions.create({
      model: args.model,
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Maximum tool iterations reached. Summarize what you accomplished and what's still pending in 1-3 sentences. Do not call any tools.",
        },
      ],
      // HEL-147 followup (Codex on PR #900): honour maxOutputTokens
      // on the wrap-up. Without this a caller setting a tight cap to
      // control runaway-loop cost still gets an uncapped summary in
      // exactly the failure mode the cap is meant to contain.
      // Falls back to 512 (tight summary) when no explicit cap.
      max_tokens:
        typeof args.maxOutputTokens === "number" ? args.maxOutputTokens : 512,
    });
    if (finalTurn.usage) {
      // HEL-145 contract iter 2: promptTokens is TOTAL; cached* are
      // sub-buckets. Preserves legacy spend-logger semantics.
      const buckets = extractOpenAICacheBucket(finalTurn.usage);
      cumulativePromptTokens += buckets.promptTokens;
      cumulativeCompletionTokens += finalTurn.usage.completion_tokens;
      if (buckets.cachedPromptTokens !== undefined) {
        cumulativeCachedTokens += buckets.cachedPromptTokens;
      }
    }
    const text = finalTurn.choices[0]?.message?.content ?? "";
    return {
      text: `${text}\n\n[interrupted: max iterations]`,
      usage: {
        promptTokens: cumulativePromptTokens,
        completionTokens: cumulativeCompletionTokens,
        cachedPromptTokens:
          cumulativeCachedTokens > 0 ? cumulativeCachedTokens : undefined,
      },
    };
  } catch {
    return {
      text: "[interrupted: max iterations]",
      usage: {
        promptTokens: cumulativePromptTokens,
        completionTokens: cumulativeCompletionTokens,
        cachedPromptTokens:
          cumulativeCachedTokens > 0 ? cumulativeCachedTokens : undefined,
      },
    };
  }
}
