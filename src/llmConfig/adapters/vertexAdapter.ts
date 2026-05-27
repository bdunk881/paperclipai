/**
 * Vertex AI provider adapter (HEL-82 follow-up).
 *
 * Translates the normalized request shape to Google Cloud Vertex AI's
 * `generateContent` API (Gemini models) and the response back. Handles
 * function calls + structured outputs via `responseSchema`.
 *
 * Vertex AI also serves Anthropic Claude models behind its API; that path
 * is a stub today — it surfaces a clear error if the model id starts with
 * `claude-` and the `@anthropic-ai/vertex-sdk` isn't wired in. The Gemini
 * code path is the must-have.
 *
 * Credentials flow:
 *   - `request.providerOptions.projectId` (required) and `.location`
 *     (defaults to `us-central1`).
 *   - Optional `serviceAccountJson` in `providerOptions` — parsed and
 *     passed via `googleAuthOptions.credentials` so we don't have to
 *     touch the filesystem or mutate `GOOGLE_APPLICATION_CREDENTIALS`.
 *     When absent, the SDK falls back to ADC (env, metadata server).
 */

import {
  VertexAI,
  type Content,
  type FunctionCall,
  type FunctionDeclarationSchema,
  type FunctionDeclarationsTool,
  type GenerateContentRequest,
  type GenerateContentResponse,
  type Part,
  type Tool,
} from "@google-cloud/vertexai";
import type { JWTInput } from "google-auth-library";

import { emitTrace } from "../../engine/agentTrace/emitCallbacks";
import type {
  NormalizedRequest,
  NormalizedResponse,
  NormalizedToolCall,
  ProviderAdapter,
} from "./types";

const GOOGLE_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_VERTEX_LOCATION = "us-central1";

interface ResolvedVertexOptions {
  projectId: string;
  location: string;
  serviceAccountJson?: string;
  endpoint?: string;
}

export class VertexAdapter implements ProviderAdapter {
  readonly provider = "vertex-ai" as const;

  async invoke(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (isClaudeModel(request.model)) {
      throw new Error(
        "Vertex adapter API error: Anthropic-on-Vertex (claude-*) is not wired yet. " +
          "Install `@anthropic-ai/vertex-sdk` and extend VertexAdapter to handle this path.",
      );
    }

    const built = this.buildRequestParams(request);
    let response: GenerateContentResponse;
    try {
      const result = await built.model.generateContent(built.payload);
      response = result.response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Vertex adapter API error: ${msg}`);
    }
    return this.normalizeResponse(response);
  }

  async invokeStream(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!request.onTrace) {
      return this.invoke(request);
    }
    if (isClaudeModel(request.model)) {
      throw new Error(
        "Vertex adapter API error: Anthropic-on-Vertex (claude-*) is not wired yet. " +
          "Install `@anthropic-ai/vertex-sdk` and extend VertexAdapter to handle this path.",
      );
    }

    const built = this.buildRequestParams(request);
    let accumulated = "";
    const onTrace = request.onTrace;
    let finalResponse: GenerateContentResponse;
    try {
      const stream = await built.model.generateContentStream(built.payload);
      for await (const chunk of stream.stream) {
        const candidate = chunk.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];
        for (const part of parts) {
          if (typeof part.text === "string" && part.text.length > 0) {
            accumulated += part.text;
            emitTrace(onTrace, {
              type: "assistant.delta",
              delta: part.text,
              accumulated,
            });
          }
        }
      }
      finalResponse = await stream.response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Vertex adapter API error: ${msg}`);
    }

    const normalized = this.normalizeResponse(finalResponse);
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
      text: normalized.content,
      usage: {
        promptTokens: normalized.usage.inputTokens,
        completionTokens: normalized.usage.outputTokens,
        cachedPromptTokens: normalized.usage.cachedInputTokens,
      },
    });
    return normalized;
  }

  private buildRequestParams(request: NormalizedRequest) {
    const options = resolveVertexOptions(request);
    const vertexAI = new VertexAI({
      project: options.projectId,
      location: options.location,
      ...(options.endpoint ? { apiEndpoint: options.endpoint } : {}),
      ...(options.serviceAccountJson
        ? {
            googleAuthOptions: {
              credentials: parseServiceAccountJson(options.serviceAccountJson),
              scopes: GOOGLE_CLOUD_PLATFORM_SCOPE,
            },
          }
        : {}),
    });

    const model = vertexAI.getGenerativeModel({ model: request.model });

    const { contents, systemInstruction } = translateMessages(request);
    const tools = translateTools(request);

    const generationConfig: Record<string, unknown> = {};
    if (typeof request.maxTokens === "number") {
      generationConfig.maxOutputTokens = request.maxTokens;
    }
    if (typeof request.temperature === "number") {
      generationConfig.temperature = request.temperature;
    }
    if (request.responseSchema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = request.responseSchema.schema;
    }

    const payload: GenerateContentRequest = {
      contents,
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(tools.length > 0 ? { tools } : {}),
      ...(Object.keys(generationConfig).length > 0
        ? { generationConfig: generationConfig as GenerateContentRequest["generationConfig"] }
        : {}),
    };

    return { model, payload };
  }

  private normalizeResponse(response: GenerateContentResponse): NormalizedResponse {
    const candidate = response.candidates?.[0];
    const parts: Part[] = candidate?.content?.parts ?? [];

    let content = "";
    const toolCalls: NormalizedToolCall[] = [];
    let toolCallIndex = 0;

    for (const part of parts) {
      if (typeof part.text === "string") {
        content += part.text;
        continue;
      }
      const fc = (part as { functionCall?: FunctionCall }).functionCall;
      if (fc && typeof fc.name === "string") {
        const args =
          fc.args && typeof fc.args === "object" ? (fc.args as Record<string, unknown>) : {};
        toolCalls.push({
          id: `vertex_tool_${toolCallIndex++}_${fc.name}`,
          name: fc.name,
          arguments: args,
        });
      }
    }

    const usageMeta = response.usageMetadata;
    const inputTokens = usageMeta?.promptTokenCount ?? 0;
    const outputTokens = usageMeta?.candidatesTokenCount ?? 0;
    const cachedRaw = usageMeta?.cachedContentTokenCount;
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
      finishReason: mapVertexFinishReason(candidate?.finishReason, toolCalls.length > 0),
      cacheHit: typeof cachedInputTokens === "number" && cachedInputTokens > 0,
      raw: response,
    };
  }
}

function isClaudeModel(model: string): boolean {
  return model.toLowerCase().startsWith("claude-");
}

function resolveVertexOptions(request: NormalizedRequest): ResolvedVertexOptions {
  const opts = (request.providerOptions ?? {}) as Record<string, unknown>;
  const projectId = typeof opts.projectId === "string" ? opts.projectId : undefined;
  if (!projectId) {
    throw new Error("Vertex adapter: providerOptions.projectId is required");
  }
  const location =
    typeof opts.location === "string" && opts.location.length > 0
      ? opts.location
      : DEFAULT_VERTEX_LOCATION;
  const serviceAccountJson =
    typeof opts.serviceAccountJson === "string" ? opts.serviceAccountJson : undefined;
  const endpoint = typeof opts.endpoint === "string" ? opts.endpoint : undefined;
  return { projectId, location, serviceAccountJson, endpoint };
}

function parseServiceAccountJson(serviceAccountJson: string): JWTInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error("Vertex adapter API error: invalid serviceAccountJson");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Vertex adapter API error: invalid serviceAccountJson");
  }
  const credentials = parsed as JWTInput;
  if (
    typeof credentials.client_email !== "string" ||
    typeof credentials.private_key !== "string"
  ) {
    throw new Error(
      "Vertex adapter API error: serviceAccountJson must include client_email and private_key",
    );
  }
  return credentials;
}

function translateMessages(request: NormalizedRequest): {
  contents: Content[];
  systemInstruction?: Content;
} {
  const contents: Content[] = [];
  let systemText = request.system ?? "";

  for (const msg of request.messages) {
    if (msg.role === "system") {
      systemText = [systemText, msg.content].filter(Boolean).join("\n\n");
      continue;
    }
    if (msg.role === "user") {
      contents.push({ role: "user", parts: [{ text: msg.content ?? "" }] });
      continue;
    }
    if (msg.role === "assistant") {
      const parts: Part[] = [];
      if (msg.content) {
        parts.push({ text: msg.content } as Part);
      }
      if (msg.toolCalls?.length) {
        for (const tc of msg.toolCalls) {
          parts.push({
            functionCall: { name: tc.name, args: tc.arguments },
          } as unknown as Part);
        }
      }
      if (parts.length === 0) {
        parts.push({ text: "" } as Part);
      }
      contents.push({ role: "model", parts });
      continue;
    }
    if (msg.role === "tool" && msg.toolResults?.length) {
      const parts: Part[] = msg.toolResults.map(
        (r) =>
          ({
            functionResponse: {
              // Vertex matches the tool result to the call by `name`. We don't
              // have it on NormalizedToolResult, so we pass an empty string and
              // rely on the callId — Vertex is lenient when only one call is
              // pending. The agent loop already serialises one result per call.
              name: r.toolCallId,
              response: safeJsonResponse(r.content, r.isError === true),
            },
          }) as unknown as Part,
      );
      contents.push({ role: "user", parts });
      continue;
    }
  }

  const systemInstruction: Content | undefined = systemText
    ? { role: "system", parts: [{ text: systemText }] }
    : undefined;

  return { contents, systemInstruction };
}

function safeJsonResponse(content: string, isError: boolean): Record<string, unknown> {
  if (isError) return { error: content };
  // Vertex expects a JSON object for `response`. If the tool returned JSON,
  // surface it as-is; otherwise wrap the string.
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { result: parsed };
  } catch {
    return { result: content };
  }
}

function translateTools(request: NormalizedRequest): Tool[] {
  if (!request.tools?.length) return [];
  const tool: FunctionDeclarationsTool = {
    functionDeclarations: request.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as unknown as FunctionDeclarationSchema,
    })),
  };
  return [tool];
}

function mapVertexFinishReason(
  reason: string | undefined,
  hasToolCalls: boolean,
): NormalizedResponse["finishReason"] {
  if (hasToolCalls && (reason === undefined || reason === "STOP")) {
    return "tool_calls";
  }
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
      return "unknown";
    default:
      return "unknown";
  }
}
