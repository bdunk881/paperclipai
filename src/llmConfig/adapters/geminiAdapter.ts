/**
 * Gemini provider adapter (HEL-82).
 *
 * Translates the normalized request shape to Google's Generative AI SDK
 * (`@google/generative-ai`) and the response back. Handles tool use +
 * native JSON-schema structured outputs.
 *
 * Wire-format notes:
 * - Gemini's `contents[]` uses roles `user` and `model` only. Our `assistant`
 *   role maps to `model`. System prompts go in the dedicated
 *   `systemInstruction` field rather than the contents array.
 * - Tool calls become `functionCall` parts; tool results become
 *   `functionResponse` parts on the user side.
 * - Structured outputs use `generationConfig.responseMimeType =
 *   "application/json"` plus `responseSchema`.
 */

import {
  GoogleGenerativeAI,
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  type GenerateContentResult,
  type GenerationConfig,
  type Part,
  type Tool,
  type UsageMetadata,
} from "@google/generative-ai";

import { emitTrace } from "../../engine/agentTrace/emitCallbacks";
import type {
  NormalizedRequest,
  NormalizedResponse,
  NormalizedToolCall,
  ProviderAdapter,
} from "./types";

interface BuiltRequest {
  client: GoogleGenerativeAI;
  contents: Content[];
  systemInstruction?: string;
  tools?: Tool[];
  generationConfig?: GenerationConfig;
}

export class GeminiAdapter implements ProviderAdapter {
  readonly provider = "gemini" as const;

  async invoke(request: NormalizedRequest): Promise<NormalizedResponse> {
    const built = this.buildRequestParams(request);
    let result: GenerateContentResult;
    try {
      const model = built.client.getGenerativeModel({
        model: request.model,
        ...(built.systemInstruction
          ? { systemInstruction: built.systemInstruction }
          : {}),
        ...(built.tools ? { tools: built.tools } : {}),
        ...(built.generationConfig
          ? { generationConfig: built.generationConfig }
          : {}),
      });
      result = await model.generateContent({ contents: built.contents });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Gemini adapter API error: ${msg}`);
    }
    return normalizeResult(result);
  }

  async invokeStream(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!request.onTrace) {
      return this.invoke(request);
    }
    const onTrace = request.onTrace;
    const built = this.buildRequestParams(request);
    let accumulated = "";
    try {
      const model = built.client.getGenerativeModel({
        model: request.model,
        ...(built.systemInstruction
          ? { systemInstruction: built.systemInstruction }
          : {}),
        ...(built.tools ? { tools: built.tools } : {}),
        ...(built.generationConfig
          ? { generationConfig: built.generationConfig }
          : {}),
      });
      const streamResult = await model.generateContentStream({
        contents: built.contents,
      });
      for await (const chunk of streamResult.stream) {
        let delta = "";
        try {
          delta = chunk.text();
        } catch {
          // Some chunks (function calls) don't carry text.
          delta = "";
        }
        if (delta) {
          accumulated += delta;
          emitTrace(onTrace, {
            type: "assistant.delta",
            delta,
            accumulated,
          });
        }
      }
      const response = await streamResult.response;
      const normalized = normalizeResult({ response });
      // Use the streamed text when the aggregated response is empty (e.g.
      // function-call-only turns), and surface the tool-call event so live
      // viewers see what's about to run.
      for (const tc of normalized.toolCalls) {
        emitTrace(onTrace, {
          type: "tool_call.completed",
          callId: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        });
      }
      emitTrace(onTrace, {
        type: "turn.completed",
        text: normalized.content || accumulated,
        usage: {
          promptTokens: normalized.usage.inputTokens,
          completionTokens: normalized.usage.outputTokens,
        },
      });
      return normalized;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emitTrace(onTrace, { type: "turn.error", message: msg });
      throw new Error(`Gemini adapter API error: ${msg}`);
    }
  }

  private buildRequestParams(request: NormalizedRequest): BuiltRequest {
    const apiKey = request.apiKey;
    if (!apiKey) {
      throw new Error("Gemini adapter: API key is required");
    }
    const client = new GoogleGenerativeAI(apiKey);

    // System prompt: merge NormalizedRequest.system with any `system` role
    // messages and pass via systemInstruction (Gemini doesn't have a system
    // role in its contents array).
    let systemPrompt = request.system ?? "";
    const contents: Content[] = [];

    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemPrompt = [systemPrompt, msg.content].filter(Boolean).join("\n\n");
        continue;
      }
      if (msg.role === "tool" && msg.toolResults?.length) {
        // Tool results map to functionResponse parts under the user role.
        // We resolve the tool call's name from the prior assistant turn so
        // Gemini can match each response to its declared function.
        const parts: Part[] = msg.toolResults.map((r) => ({
          functionResponse: {
            name: lookupToolNameById(request, r.toolCallId) ?? r.toolCallId,
            response: { content: r.content, isError: r.isError === true },
          },
        }));
        contents.push({ role: "user", parts });
        continue;
      }
      if (msg.role === "user") {
        contents.push({
          role: "user",
          parts: [{ text: msg.content ?? "" }],
        });
        continue;
      }
      if (msg.role === "assistant") {
        const parts: Part[] = [];
        if (msg.content) parts.push({ text: msg.content });
        if (msg.toolCalls?.length) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: { name: tc.name, args: tc.arguments },
            });
          }
        }
        // Always emit at least one part so the SDK accepts the content block.
        if (parts.length === 0) parts.push({ text: "" });
        contents.push({ role: "model", parts });
      }
    }

    // Function declarations (tools + optional structured-output bridge).
    const functionDeclarations: FunctionDeclaration[] = (request.tools ?? []).map(
      (t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters as unknown as FunctionDeclaration["parameters"],
      }),
    );
    const tools: Tool[] | undefined =
      functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined;

    // Generation config: temperature, maxTokens, and structured output.
    const generationConfig: GenerationConfig = {};
    if (typeof request.maxTokens === "number") {
      generationConfig.maxOutputTokens = request.maxTokens;
    }
    if (typeof request.temperature === "number") {
      generationConfig.temperature = request.temperature;
    }
    if (request.responseSchema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = request.responseSchema
        .schema as unknown as GenerationConfig["responseSchema"];
    }

    return {
      client,
      contents,
      systemInstruction: systemPrompt || undefined,
      tools,
      generationConfig:
        Object.keys(generationConfig).length > 0 ? generationConfig : undefined,
    };
  }
}

function lookupToolNameById(
  request: NormalizedRequest,
  toolCallId: string,
): string | undefined {
  for (const msg of request.messages) {
    if (msg.role === "assistant" && msg.toolCalls) {
      const hit = msg.toolCalls.find((tc) => tc.id === toolCallId);
      if (hit) return hit.name;
    }
  }
  return undefined;
}

function normalizeResult(result: {
  response: { candidates?: unknown[]; usageMetadata?: UsageMetadata } & {
    text?: () => string;
    functionCalls?: () => FunctionCall[] | undefined;
  };
}): NormalizedResponse {
  const response = result.response;
  let content = "";
  if (typeof response.text === "function") {
    try {
      content = response.text() || "";
    } catch {
      content = "";
    }
  }

  const toolCalls: NormalizedToolCall[] = [];
  let functionCalls: FunctionCall[] | undefined;
  if (typeof response.functionCalls === "function") {
    try {
      functionCalls = response.functionCalls();
    } catch {
      functionCalls = undefined;
    }
  }
  if (functionCalls?.length) {
    functionCalls.forEach((fc, i) => {
      toolCalls.push({
        id: `gemini-fc-${i}`,
        name: fc.name,
        arguments:
          typeof fc.args === "object" && fc.args !== null
            ? (fc.args as Record<string, unknown>)
            : {},
      });
    });
  }

  const usageMeta = response.usageMetadata;
  const cachedInputTokens = usageMeta?.cachedContentTokenCount;
  const usage = {
    inputTokens: usageMeta?.promptTokenCount ?? 0,
    outputTokens: usageMeta?.candidatesTokenCount ?? 0,
    cachedInputTokens:
      typeof cachedInputTokens === "number" && cachedInputTokens > 0
        ? cachedInputTokens
        : undefined,
  };

  const finishReason = mapGeminiFinishReason(
    response.candidates,
    toolCalls.length > 0,
  );

  return {
    content,
    toolCalls,
    usage,
    finishReason,
    cacheHit:
      typeof cachedInputTokens === "number" && cachedInputTokens > 0
        ? true
        : false,
    raw: response,
  };
}

function mapGeminiFinishReason(
  candidates: unknown[] | undefined,
  hasToolCalls: boolean,
): NormalizedResponse["finishReason"] {
  if (hasToolCalls) return "tool_calls";
  const first = candidates?.[0] as { finishReason?: string } | undefined;
  const reason = first?.finishReason;
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
      return "content_filter";
    case undefined:
      return "stop";
    default:
      return "unknown";
  }
}
