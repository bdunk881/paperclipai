import Anthropic from "@anthropic-ai/sdk";
import { resolveTraceCallback } from "../agentTrace/emitCallbacks";
import {
  createAnthropicStreamAccumulators,
  wireAnthropicMessageStream,
} from "./anthropicStream";
import {
  DEFAULT_LLM_REQUEST_TIMEOUT_MS,
  LLMProvider,
  LLMProviderConfig,
  LLMResponse,
  ResponseFormat,
} from "./types";

/**
 * Anthropic doesn't expose a `response_format` knob — the recommended
 * way to force JSON is to define a tool whose input_schema is the
 * desired shape and then `tool_choice` that tool. The model then
 * "calls" the tool with a `tool_use` block whose `input` is a
 * structured object matching the schema.
 *
 * We expose that as `{ type: "json_object" | "json_schema" }` so the
 * caller doesn't have to know about Claude's tool-use mechanic.
 *
 * Returns null when no structured output was requested, in which case
 * the normal text path runs.
 */
const FORCED_TOOL_NAME = "respond_with_json";

function toAnthropicForcedTool(
  responseFormat: ResponseFormat | undefined,
):
  | {
      tools: Anthropic.Messages.Tool[];
      tool_choice: { type: "tool"; name: string };
    }
  | null {
  if (!responseFormat || responseFormat.type === "text") return null;
  const schema =
    responseFormat.type === "json_schema"
      ? responseFormat.schema
      : // Permissive shape for json_object mode — the model still
        // produces a structured object, just without a schema check.
        ({ type: "object", additionalProperties: true } as Record<string, unknown>);
  return {
    tools: [
      {
        name: FORCED_TOOL_NAME,
        description:
          "Respond with a structured JSON object matching the input_schema. Do not return prose.",
        input_schema: schema as Anthropic.Messages.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: FORCED_TOOL_NAME },
  };
}

export function createAnthropicProvider(config: LLMProviderConfig): LLMProvider {
  const apiKey = config.apiKey ?? config.credentials?.apiKey;
  if (!apiKey) {
    throw new Error(`Anthropic API error: missing API key credentials for ${config.provider}`);
  }

  // Explicit per-request timeout — see DEFAULT_LLM_REQUEST_TIMEOUT_MS.
  // Anthropic's SDK default is 10 minutes, but we want a uniform ceiling
  // across providers so a slow Claude call can't outlive our Express
  // request budget.
  const timeoutMs = config.requestTimeoutMs ?? DEFAULT_LLM_REQUEST_TIMEOUT_MS;
  const client = new Anthropic({ apiKey, timeout: timeoutMs });
  const forcedTool = toAnthropicForcedTool(config.responseFormat);

  // HEL-145: prompt-caching plumbing. When the caller passes a
  // `systemPrompt`, we send it in Anthropic's dedicated `system` field
  // (instead of the legacy "inline into the user message" behaviour).
  // When `cacheSystemPrompt` is also true, we tag the system block
  // with `cache_control: ephemeral` so Anthropic caches the prefix for
  // ~5 minutes. Tool definitions live before the user message in
  // Anthropic's request order, so caching the system block implicitly
  // caches the tool list too — no separate cache breakpoint needed.
  const systemField = buildAnthropicSystemField(
    config.systemPrompt,
    config.cacheSystemPrompt === true,
  );
  const cachingEnabled = Boolean(config.systemPrompt && config.cacheSystemPrompt);

  function readCachedTokens(
    usage: Anthropic.Messages.Usage,
  ): number | undefined {
    const raw = (usage as { cache_read_input_tokens?: number | null })
      .cache_read_input_tokens;
    return typeof raw === "number" && raw > 0 ? raw : undefined;
  }

  function readCacheCreationTokens(
    usage: Anthropic.Messages.Usage,
  ): number | undefined {
    // HEL-145 followup (Codex review on PR #898): Anthropic returns
    // input_tokens / cache_read_input_tokens / cache_creation_input_tokens
    // as THREE separate buckets. The cache-write bucket is billed at
    // ~1.25× standard input rate; missing it undercounts first-call
    // cost. Subsequent requests within the 5-min TTL surface those
    // same tokens as cache_read_input_tokens instead.
    const raw = (usage as { cache_creation_input_tokens?: number | null })
      .cache_creation_input_tokens;
    return typeof raw === "number" && raw > 0 ? raw : undefined;
  }

  /**
   * Roll Anthropic's three input-token buckets into a single TOTAL
   * count that matches the legacy `promptTokens` semantics. Cost
   * loggers (missionRoutes, stepHandlers, hosted-free accounting) read
   * only this field; undercounting on cache hits would silently
   * understate spend. Cache-aware billing subtracts the cached*
   * sub-buckets to apply discounted rates (see types.ts contract).
   */
  function totalPromptTokens(usage: Anthropic.Messages.Usage): number {
    const cached = readCachedTokens(usage) ?? 0;
    const creation = readCacheCreationTokens(usage) ?? 0;
    return usage.input_tokens + cached + creation;
  }

  return async (prompt: string): Promise<LLMResponse> => {
    const onTrace = resolveTraceCallback(config);

    // HEL-82: the agentic tool-loop is implemented in
    // src/agents/runtime/fallbackAgentBackend.ts on top of the
    // NormalizedRequest adapters. This provider is now bare-API only —
    // one-shot text or forced-tool JSON. If `tools` is passed it's a
    // caller mistake.
    if (config.tools && config.tools.length > 0 && !forcedTool) {
      throw new Error(
        "createAnthropicProvider: legacy `tools`/tool-loop path retired. " +
          "Route agent runs through src/agents/runtime/runAgent.ts (FallbackAgentBackend) instead.",
      );
    }

    // Streaming path: caller wired onTrace / onText to forward
    // incremental deltas (e.g. SSE → agent presence pill). Use the
    // Anthropic SDK's `messages.stream` helper so we still get the
    // final assembled message + usage when the stream completes.
    //
    // Streaming is incompatible with forced-tool JSON mode in a
    // straightforward way (we'd have to assemble tool_use blocks from
    // input_json_delta events). When `responseFormat` is set, skip the
    // stream and fall through to the standard create() call so
    // structured-output callers continue to get clean JSON.
    if (onTrace && !forcedTool) {
      const acc = createAnthropicStreamAccumulators();
      try {
        const stream = client.messages.stream({
          model: config.model,
          max_tokens: config.maxOutputTokens ?? 4096,
          system: systemField,
          messages: [{ role: "user", content: prompt }],
        });
        wireAnthropicMessageStream(stream, onTrace, acc);
        const final = await stream.finalMessage();
        const usage = {
          promptTokens: totalPromptTokens(final.usage),
          completionTokens: final.usage.output_tokens,
          cachedPromptTokens: readCachedTokens(final.usage),
          cachedCreationTokens: readCacheCreationTokens(final.usage),
        };
        const text = extractAssistantText(final.content) || acc.assistantText;
        return { text, usage };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Anthropic API error: ${msg}`);
      }
    }

    let response;
    try {
      response = await client.messages.create({
        model: config.model,
        max_tokens: config.maxOutputTokens ?? 4096,
        system: systemField,
        messages: [{ role: "user", content: prompt }],
        ...(forcedTool ?? {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Anthropic API error: ${msg}`);
    }

    // When forced tool-use is in effect, the response carries a
    // `tool_use` block whose `input` is the structured JSON object.
    // Serialize it back to a string so the shared `LLMResponse.text`
    // contract holds for every caller — the Tier 1 extractor will
    // parse it back without doing any heuristic work.
    let text = "";
    if (forcedTool) {
      const toolBlock = response.content.find(
        (block): block is Anthropic.Messages.ToolUseBlock =>
          block.type === "tool_use" && block.name === FORCED_TOOL_NAME,
      );
      if (toolBlock) {
        text = JSON.stringify(toolBlock.input);
      }
    }
    if (!text) {
      const firstBlock = response.content[0];
      text = firstBlock?.type === "text" ? firstBlock.text : "";
    }

    const usage = {
      promptTokens: totalPromptTokens(response.usage),
      completionTokens: response.usage.output_tokens,
      cachedPromptTokens: readCachedTokens(response.usage),
      cachedCreationTokens: readCacheCreationTokens(response.usage),
    };

    return { text, usage };
  };
}

/**
 * Builds Anthropic's `system` field from the caller's systemPrompt.
 *
 * - No systemPrompt → returns undefined; Anthropic treats this as "no
 *   system message". Callers that pre-inlined their system prompt into
 *   the user message keep working unchanged.
 * - systemPrompt + no cache flag → returns the string. Anthropic accepts
 *   either a bare string or an array of TextBlock; bare string is what
 *   it expects when there's nothing to cache.
 * - systemPrompt + cache flag → returns a single-element array of a
 *   TextBlock with `cache_control: ephemeral`. Anthropic caches every
 *   block from the start of the request up to and including the last
 *   block with `cache_control`, so this tags everything (system + tools)
 *   in a single breakpoint.
 *
 * Returned shape is intentionally `string | Anthropic.TextBlockParam[]`
 * so the create() / stream() callers can spread it directly into the
 * `system` field of `messages.create` / `messages.stream`.
 */
function buildAnthropicSystemField(
  systemPrompt: string | undefined,
  enableCaching: boolean,
): string | Anthropic.Messages.TextBlockParam[] | undefined {
  if (!systemPrompt) return undefined;
  if (!enableCaching) return systemPrompt;
  return [
    {
      type: "text",
      text: systemPrompt,
      cache_control: { type: "ephemeral" },
    },
  ];
}

function extractAssistantText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
