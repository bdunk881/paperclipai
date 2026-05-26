/**
 * Mistral provider adapter (HEL-82).
 *
 * Translates the normalized request shape to Mistral's chat completions API
 * (via the official `@mistralai/mistralai` SDK) and the response back.
 * Handles tool calls + native JSON-schema structured outputs.
 *
 * Mistral's wire format is OpenAI-compatible for messages and tools, with a
 * couple of camelCase quirks the SDK surfaces:
 *   - structured output:  `responseFormat: { type: "json_schema", jsonSchema: { name, schemaDefinition, strict } }`
 *   - usage tokens:       `usage: { promptTokens, completionTokens }`
 *   - streaming chunks:   `client.chat.stream(...)` returns an AsyncIterable of `{ data: CompletionChunk }`
 */

// `@mistralai/mistralai` is ESM-only (its package.json sets
// `"type": "module"` and points `main` at `./esm/index.js`). The rest
// of this codebase compiles to CJS, so importing the SDK statically
// would compile to a `require()` and throw ERR_REQUIRE_ESM at runtime.
// `loadMistralSdk` in `./sdkLoaders` does the dynamic-`import()` dance;
// tests `jest.mock("./sdkLoaders", ...)` to inject a stub.
import { loadMistralSdk } from "./sdkLoaders";

import { emitTrace } from "../../engine/agentTrace/emitCallbacks";
import type {
  NormalizedRequest,
  NormalizedResponse,
  NormalizedToolCall,
  ProviderAdapter,
} from "./types";

// Mistral SDK's typed surface for the chat request lags its public API for
// structured-output and tool-result shapes. We keep the typing loose at the
// boundary (the SDK accepts the documented JSON in practice) and parse the
// strongly-typed response.
type MistralChatMessage = Record<string, unknown>;

interface MistralToolCallShape {
  id?: string;
  type?: string;
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
}

interface MistralAssistantMessageShape {
  role?: string;
  content?: string | Array<{ type: string; text?: string }> | null;
  toolCalls?: MistralToolCallShape[] | null;
}

interface MistralChoiceShape {
  index: number;
  message?: MistralAssistantMessageShape;
  finishReason: string | null;
}

interface MistralChatResponseShape {
  id: string;
  choices: MistralChoiceShape[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export class MistralAdapter implements ProviderAdapter {
  readonly provider = "mistral" as const;

  async invoke(request: NormalizedRequest): Promise<NormalizedResponse> {
    const built = await this.buildRequestParams(request);
    let raw: MistralChatResponseShape;
    try {
      raw = (await built.client.chat.complete(
        built.body as Parameters<typeof built.client.chat.complete>[0],
      )) as unknown as MistralChatResponseShape;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Mistral adapter API error: ${msg}`);
    }
    return this.normalizeResponse(raw);
  }

  async invokeStream(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!request.onTrace) {
      return this.invoke(request);
    }
    const built = await this.buildRequestParams(request);
    const onTrace = request.onTrace;

    let accumulatedText = "";
    let finalUsage: { promptTokens?: number; completionTokens?: number } | undefined;
    let finishReason: string | null = null;
    // Tool calls accumulate from streamed deltas, keyed by index when id is absent.
    const toolCallsByKey = new Map<
      string,
      { id: string; name: string; argsBuffer: string }
    >();

    try {
      const stream = await built.client.chat.stream(
        built.body as Parameters<typeof built.client.chat.stream>[0],
      );
      for await (const event of stream as AsyncIterable<{
        data: {
          choices?: Array<{
            delta?: {
              content?: string | null;
              toolCalls?: MistralToolCallShape[] | null;
            };
            finishReason?: string | null;
          }>;
          usage?: { promptTokens?: number; completionTokens?: number };
        };
      }>) {
        const data = event.data;
        const choice = data.choices?.[0];
        if (!choice) {
          if (data.usage) finalUsage = data.usage;
          continue;
        }
        if (choice.finishReason) finishReason = choice.finishReason;

        const deltaContent = choice.delta?.content;
        if (typeof deltaContent === "string" && deltaContent.length > 0) {
          accumulatedText += deltaContent;
          emitTrace(onTrace, {
            type: "assistant.delta",
            delta: deltaContent,
            accumulated: accumulatedText,
          });
        }

        const deltaToolCalls = choice.delta?.toolCalls;
        if (Array.isArray(deltaToolCalls)) {
          for (let i = 0; i < deltaToolCalls.length; i++) {
            const tc = deltaToolCalls[i]!;
            const key = tc.id ?? String(i);
            let entry = toolCallsByKey.get(key);
            if (!entry) {
              entry = {
                id: tc.id ?? `tc_${toolCallsByKey.size}`,
                name: tc.function.name,
                argsBuffer: "",
              };
              toolCallsByKey.set(key, entry);
            }
            if (tc.function.name) entry.name = tc.function.name;
            const a = tc.function.arguments;
            if (typeof a === "string") entry.argsBuffer += a;
            else if (a && typeof a === "object") entry.argsBuffer = JSON.stringify(a);
          }
        }

        if (data.usage) finalUsage = data.usage;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Mistral adapter API error: ${msg}`);
    }

    const toolCalls: NormalizedToolCall[] = [];
    for (const entry of toolCallsByKey.values()) {
      let parsed: Record<string, unknown> = {};
      if (entry.argsBuffer.length > 0) {
        try {
          parsed = JSON.parse(entry.argsBuffer);
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

    const usage = {
      inputTokens: finalUsage?.promptTokens ?? 0,
      outputTokens: finalUsage?.completionTokens ?? 0,
    };

    emitTrace(onTrace, {
      type: "turn.completed",
      text: accumulatedText,
      usage: {
        promptTokens: usage.inputTokens,
        completionTokens: usage.outputTokens,
      },
    });

    return {
      content: accumulatedText,
      toolCalls,
      usage,
      finishReason: mapMistralFinishReason(finishReason),
    };
  }

  private async buildRequestParams(request: NormalizedRequest) {
    const apiKey = request.apiKey;
    if (!apiKey) {
      throw new Error("Mistral adapter: API key is required");
    }
    const { Mistral } = await loadMistralSdk();
    const client = new Mistral({ apiKey });

    // Translate messages — OpenAI-compatible shape.
    const messages: MistralChatMessage[] = [];
    if (request.system) {
      messages.push({ role: "system", content: request.system });
    }
    for (const msg of request.messages) {
      if (msg.role === "system") {
        messages.push({ role: "system", content: msg.content ?? "" });
        continue;
      }
      if (msg.role === "tool" && msg.toolResults?.length) {
        for (const r of msg.toolResults) {
          messages.push({
            role: "tool",
            tool_call_id: r.toolCallId,
            content: r.content,
          });
        }
        continue;
      }
      if (msg.role === "user") {
        messages.push({ role: "user", content: msg.content ?? "" });
        continue;
      }
      if (msg.role === "assistant") {
        const m: MistralChatMessage = { role: "assistant" };
        if (msg.content) m.content = msg.content;
        if (msg.toolCalls?.length) {
          m.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }
        messages.push(m);
      }
    }

    // Translate tools — OpenAI-compatible function tool format.
    const tools = (request.tools ?? []).map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    // Structured output uses Mistral's camelCase shape:
    //   responseFormat: { type: "json_schema", jsonSchema: { name, schemaDefinition, strict } }
    let responseFormat: Record<string, unknown> | undefined;
    if (request.responseSchema) {
      responseFormat = {
        type: "json_schema",
        jsonSchema: {
          name: request.responseSchema.name,
          schemaDefinition: request.responseSchema.schema,
          strict: true,
        },
      };
    }

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
    };
    if (typeof request.maxTokens === "number") body.maxTokens = request.maxTokens;
    if (typeof request.temperature === "number") body.temperature = request.temperature;
    if (tools.length > 0) body.tools = tools;
    if (responseFormat) body.responseFormat = responseFormat;

    return { client, body };
  }

  private normalizeResponse(raw: MistralChatResponseShape): NormalizedResponse {
    const choice = raw.choices?.[0];
    const message = choice?.message;

    let content = "";
    if (typeof message?.content === "string") {
      content = message.content;
    } else if (Array.isArray(message?.content)) {
      // Mistral can return content as an array of chunks for multimodal models.
      content = message!.content
        .map((c) => (c.type === "text" && typeof c.text === "string" ? c.text : ""))
        .join("");
    }

    const toolCalls: NormalizedToolCall[] = (message?.toolCalls ?? []).map((tc, i) => {
      let parsedArgs: Record<string, unknown> = {};
      const a = tc.function.arguments;
      if (typeof a === "string") {
        try {
          parsedArgs = a.length > 0 ? (JSON.parse(a) as Record<string, unknown>) : {};
        } catch {
          parsedArgs = {};
        }
      } else if (a && typeof a === "object") {
        parsedArgs = a as Record<string, unknown>;
      }
      return {
        id: tc.id ?? `tc_${i}`,
        name: tc.function.name,
        arguments: parsedArgs,
      };
    });

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: raw.usage?.promptTokens ?? 0,
        outputTokens: raw.usage?.completionTokens ?? 0,
      },
      finishReason: mapMistralFinishReason(choice?.finishReason ?? null),
      raw,
    };
  }
}

function mapMistralFinishReason(reason: string | null) {
  switch (reason) {
    case "stop":
      return "stop" as const;
    case "length":
    case "model_length":
      return "length" as const;
    case "tool_calls":
      return "tool_calls" as const;
    case "error":
      return "error" as const;
    default:
      return "unknown" as const;
  }
}
