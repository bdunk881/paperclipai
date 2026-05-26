/**
 * AWS Bedrock provider adapter (HEL-82 follow-up).
 *
 * Translates the normalized request shape to Amazon Bedrock's Converse API
 * (`ConverseCommand` / `ConverseStreamCommand`) and the response back.
 * Handles tool use + structured outputs.
 *
 * Structured outputs strategy: Bedrock's Converse API doesn't have a native
 * JSON-schema response format. We mirror the Anthropic adapter's pattern —
 * define a single tool whose `inputSchema.json` is the desired schema, force
 * the model to call it (`toolChoice: { tool: { name } }`), and read the
 * structured arguments back as the assistant's lone toolCall.
 *
 * Credentials flow:
 *   - `request.providerOptions.accessKeyId` (required)
 *   - `request.providerOptions.secretAccessKey` (required)
 *   - `request.providerOptions.region` (required)
 *   - `request.providerOptions.sessionToken` (optional)
 *   - `request.providerOptions.endpoint` (optional override)
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ContentBlock,
  type ConverseCommandInput,
  type ConverseCommandOutput,
  type Message,
  type StopReason,
  type SystemContentBlock,
  type Tool,
  type ToolConfiguration,
} from "@aws-sdk/client-bedrock-runtime";

import { emitTrace } from "../../engine/agentTrace/emitCallbacks";
import type {
  NormalizedRequest,
  NormalizedResponse,
  NormalizedToolCall,
  ProviderAdapter,
} from "./types";

const STRUCTURED_OUTPUT_TOOL_NAME = "__structured_output__";

interface ResolvedBedrockOptions {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  sessionToken?: string;
  endpoint?: string;
}

export class BedrockAdapter implements ProviderAdapter {
  readonly provider = "bedrock" as const;

  async invoke(request: NormalizedRequest): Promise<NormalizedResponse> {
    const built = this.buildRequestParams(request);
    let response: ConverseCommandOutput;
    try {
      response = await built.client.send(new ConverseCommand(built.payload));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Bedrock adapter API error: ${msg}`);
    }
    return this.normalizeResponse(response);
  }

  async invokeStream(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!request.onTrace) {
      return this.invoke(request);
    }
    const onTrace = request.onTrace;
    const built = this.buildRequestParams(request);

    let accumulatedText = "";
    let finalStopReason: StopReason | undefined;
    const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
    // Tool calls assembled from streamed input deltas, keyed by contentBlockIndex.
    const toolCallsByIndex = new Map<
      number,
      { id: string; name: string; argsBuffer: string }
    >();

    try {
      const result = await built.client.send(new ConverseStreamCommand(built.payload));
      const stream = result.stream;
      if (stream) {
        for await (const event of stream) {
          if (event.contentBlockStart?.start?.toolUse) {
            const idx = event.contentBlockStart.contentBlockIndex ?? 0;
            const tu = event.contentBlockStart.start.toolUse;
            toolCallsByIndex.set(idx, {
              id: tu.toolUseId ?? `tc_${idx}`,
              name: tu.name ?? "",
              argsBuffer: "",
            });
            continue;
          }
          if (event.contentBlockDelta?.delta) {
            const delta = event.contentBlockDelta.delta;
            const idx = event.contentBlockDelta.contentBlockIndex ?? 0;
            if (typeof delta.text === "string" && delta.text.length > 0) {
              accumulatedText += delta.text;
              emitTrace(onTrace, {
                type: "assistant.delta",
                delta: delta.text,
                accumulated: accumulatedText,
              });
            }
            if (delta.toolUse && typeof delta.toolUse.input === "string") {
              const entry = toolCallsByIndex.get(idx);
              if (entry) {
                entry.argsBuffer += delta.toolUse.input;
              }
            }
            continue;
          }
          if (event.messageStop?.stopReason) {
            finalStopReason = event.messageStop.stopReason;
            continue;
          }
          if (event.metadata?.usage) {
            usage.inputTokens = event.metadata.usage.inputTokens ?? usage.inputTokens;
            usage.outputTokens = event.metadata.usage.outputTokens ?? usage.outputTokens;
            const cached = event.metadata.usage.cacheReadInputTokens;
            if (typeof cached === "number") usage.cachedInputTokens = cached;
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Bedrock adapter API error: ${msg}`);
    }

    const toolCalls: NormalizedToolCall[] = [];
    for (const entry of toolCallsByIndex.values()) {
      let parsed: Record<string, unknown> = {};
      if (entry.argsBuffer.length > 0) {
        try {
          parsed = JSON.parse(entry.argsBuffer) as Record<string, unknown>;
        } catch {
          parsed = {};
        }
      }
      const tc: NormalizedToolCall = {
        id: entry.id,
        name: entry.name,
        arguments: parsed,
      };
      toolCalls.push(tc);
      emitTrace(onTrace, {
        type: "tool_call.completed",
        callId: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      });
    }

    emitTrace(onTrace, {
      type: "turn.completed",
      text: accumulatedText,
      usage: {
        promptTokens: usage.inputTokens,
        completionTokens: usage.outputTokens,
        cachedPromptTokens: usage.cachedInputTokens || undefined,
      },
    });

    return {
      content: accumulatedText,
      toolCalls,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens || undefined,
      },
      finishReason: mapBedrockStopReason(finalStopReason),
      cacheHit: usage.cachedInputTokens > 0,
    };
  }

  private buildRequestParams(request: NormalizedRequest): {
    client: BedrockRuntimeClient;
    payload: ConverseCommandInput;
  } {
    const opts = resolveBedrockOptions(request);

    const client = new BedrockRuntimeClient({
      region: opts.region,
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
        ...(opts.sessionToken ? { sessionToken: opts.sessionToken } : {}),
      },
    });

    const { messages, systemBlocks } = translateMessages(request);
    const toolConfig = translateTools(request);

    const inferenceConfig: NonNullable<ConverseCommandInput["inferenceConfig"]> = {};
    if (typeof request.maxTokens === "number") {
      inferenceConfig.maxTokens = request.maxTokens;
    }
    if (typeof request.temperature === "number") {
      inferenceConfig.temperature = request.temperature;
    }

    const payload: ConverseCommandInput = {
      modelId: request.model,
      messages,
      ...(systemBlocks.length > 0 ? { system: systemBlocks } : {}),
      ...(toolConfig ? { toolConfig } : {}),
      ...(Object.keys(inferenceConfig).length > 0 ? { inferenceConfig } : {}),
    };

    return { client, payload };
  }

  private normalizeResponse(response: ConverseCommandOutput): NormalizedResponse {
    const message =
      response.output && "message" in response.output ? response.output.message : undefined;
    const blocks: ContentBlock[] = message?.content ?? [];

    let content = "";
    const toolCalls: NormalizedToolCall[] = [];
    for (const block of blocks) {
      if ("text" in block && typeof block.text === "string") {
        content += block.text;
        continue;
      }
      if ("toolUse" in block && block.toolUse) {
        const input = block.toolUse.input;
        const args: Record<string, unknown> =
          input && typeof input === "object" && !Array.isArray(input)
            ? (input as Record<string, unknown>)
            : {};
        toolCalls.push({
          id: block.toolUse.toolUseId ?? `tc_${toolCalls.length}`,
          name: block.toolUse.name ?? "",
          arguments: args,
        });
      }
    }

    const inputTokens = response.usage?.inputTokens ?? 0;
    const outputTokens = response.usage?.outputTokens ?? 0;
    const cachedRaw = response.usage?.cacheReadInputTokens;
    const cachedInputTokens =
      typeof cachedRaw === "number" && cachedRaw > 0 ? cachedRaw : undefined;

    return {
      content,
      toolCalls,
      usage: {
        inputTokens,
        outputTokens,
        cachedInputTokens,
      },
      finishReason: mapBedrockStopReason(response.stopReason),
      cacheHit: typeof cachedInputTokens === "number" && cachedInputTokens > 0,
      raw: response,
    };
  }
}

function resolveBedrockOptions(request: NormalizedRequest): ResolvedBedrockOptions {
  const opts = (request.providerOptions ?? {}) as Record<string, unknown>;
  const accessKeyId = typeof opts.accessKeyId === "string" ? opts.accessKeyId : undefined;
  const secretAccessKey =
    typeof opts.secretAccessKey === "string" ? opts.secretAccessKey : undefined;
  const region = typeof opts.region === "string" ? opts.region : undefined;
  const sessionToken = typeof opts.sessionToken === "string" ? opts.sessionToken : undefined;
  const endpoint = typeof opts.endpoint === "string" ? opts.endpoint : undefined;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Bedrock adapter: providerOptions.accessKeyId and secretAccessKey are required");
  }
  if (!region) {
    throw new Error("Bedrock adapter: providerOptions.region is required");
  }
  return { accessKeyId, secretAccessKey, region, sessionToken, endpoint };
}

function translateMessages(request: NormalizedRequest): {
  messages: Message[];
  systemBlocks: SystemContentBlock[];
} {
  const messages: Message[] = [];
  let systemText = request.system ?? "";

  for (const msg of request.messages) {
    if (msg.role === "system") {
      systemText = [systemText, msg.content].filter(Boolean).join("\n\n");
      continue;
    }
    if (msg.role === "tool" && msg.toolResults?.length) {
      messages.push({
        role: "user",
        content: msg.toolResults.map(
          (r) =>
            ({
              toolResult: {
                toolUseId: r.toolCallId,
                content: [{ text: r.content }],
                ...(r.isError === true ? { status: "error" } : {}),
              },
            }) as ContentBlock,
        ),
      });
      continue;
    }
    if (msg.role === "user") {
      messages.push({
        role: "user",
        content: [{ text: msg.content ?? "" } as ContentBlock],
      });
      continue;
    }
    if (msg.role === "assistant") {
      const blocks: ContentBlock[] = [];
      if (msg.content) {
        blocks.push({ text: msg.content } as ContentBlock);
      }
      if (msg.toolCalls?.length) {
        for (const tc of msg.toolCalls) {
          blocks.push({
            toolUse: {
              toolUseId: tc.id,
              name: tc.name,
              input: tc.arguments,
            },
          } as ContentBlock);
        }
      }
      messages.push({ role: "assistant", content: blocks });
    }
  }

  const systemBlocks: SystemContentBlock[] = systemText
    ? [{ text: systemText } as SystemContentBlock]
    : [];

  return { messages, systemBlocks };
}

function translateTools(request: NormalizedRequest): ToolConfiguration | undefined {
  const tools: Tool[] = (request.tools ?? []).map(
    (t) =>
      ({
        toolSpec: {
          name: t.name,
          description: t.description,
          inputSchema: { json: t.parameters },
        },
      }) as Tool,
  );

  let toolChoice: ToolConfiguration["toolChoice"] | undefined;
  if (request.responseSchema) {
    tools.push({
      toolSpec: {
        name: STRUCTURED_OUTPUT_TOOL_NAME,
        description:
          "Emit the final structured output. Always call this tool exactly once with the response data.",
        inputSchema: { json: request.responseSchema.schema },
      },
    } as Tool);
    toolChoice = { tool: { name: STRUCTURED_OUTPUT_TOOL_NAME } };
  }

  if (tools.length === 0) return undefined;
  return {
    tools,
    ...(toolChoice ? { toolChoice } : {}),
  };
}

function mapBedrockStopReason(reason: StopReason | undefined): NormalizedResponse["finishReason"] {
  switch (reason) {
    case "end_turn":
      return "stop";
    case "stop_sequence":
      return "stop";
    case "tool_use":
      return "tool_calls";
    case "max_tokens":
      return "length";
    case "content_filtered":
    case "guardrail_intervened":
      return "content_filter";
    case undefined:
      return "unknown";
    default:
      return "unknown";
  }
}
