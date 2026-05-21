import { GoogleGenerativeAI } from "@google/generative-ai";
import { emitTrace, resolveTraceCallback } from "../agentTrace/emitCallbacks";
import {
  DEFAULT_LLM_REQUEST_TIMEOUT_MS,
  LLMProvider,
  LLMProviderConfig,
  LLMResponse,
  ResponseFormat,
} from "./types";

/**
 * Convert our provider-agnostic ResponseFormat into Gemini's
 * `generationConfig.responseMimeType` + optional `responseSchema`.
 * Gemini 1.5 and 2.0 accept JSON Schema (Draft-2020-12-ish) directly
 * via responseSchema; older models only honor the MIME-type hint.
 *
 * Returns undefined when no structured output was requested so the
 * normal text-completion path runs.
 */
function toGeminiGenerationConfig(
  responseFormat: ResponseFormat | undefined,
  maxOutputTokens: number | undefined,
):
  | {
      responseMimeType?: string;
      responseSchema?: Record<string, unknown>;
      maxOutputTokens?: number;
    }
  | undefined {
  const cfg: {
    responseMimeType?: string;
    responseSchema?: Record<string, unknown>;
    maxOutputTokens?: number;
  } = {};
  if (responseFormat && responseFormat.type !== "text") {
    cfg.responseMimeType = "application/json";
    if (responseFormat.type === "json_schema") {
      cfg.responseSchema = responseFormat.schema;
    }
  }
  // HEL-147 followup (Codex review on PR #900): honor the per-call cap
  // for Gemini too. The previous version only Anthropic + OpenAI-compat
  // respected maxOutputTokens.
  if (typeof maxOutputTokens === "number" && maxOutputTokens > 0) {
    cfg.maxOutputTokens = maxOutputTokens;
  }
  return Object.keys(cfg).length > 0 ? cfg : undefined;
}

export function createGeminiProvider(config: LLMProviderConfig): LLMProvider {
  const apiKey = config.apiKey ?? config.credentials?.apiKey;
  if (!apiKey) {
    throw new Error(`Gemini API error: missing API key credentials for ${config.provider}`);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const generationConfig = toGeminiGenerationConfig(
    config.responseFormat,
    config.maxOutputTokens,
  );
  // Explicit per-request timeout — see DEFAULT_LLM_REQUEST_TIMEOUT_MS.
  // Gemini's SDK passes this through `requestOptions.timeout` to the
  // underlying fetch.
  const timeoutMs = config.requestTimeoutMs ?? DEFAULT_LLM_REQUEST_TIMEOUT_MS;

  const onTrace = resolveTraceCallback(config);

  return async (prompt: string): Promise<LLMResponse> => {
    const modelParams = {
      model: config.model,
      ...(generationConfig ? { generationConfig } : {}),
    } as Parameters<typeof genAI.getGenerativeModel>[0];
    const model = genAI.getGenerativeModel(modelParams, { timeout: timeoutMs });

    if (onTrace && !config.responseFormat) {
      let accumulated = "";
      try {
        const streamResult = await model.generateContentStream(prompt);
        for await (const chunk of streamResult.stream) {
          const delta = chunk.text();
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
        const usageMeta = response.usageMetadata;
        const usage = {
          promptTokens: usageMeta?.promptTokenCount ?? 0,
          completionTokens: usageMeta?.candidatesTokenCount ?? 0,
        };
        const text = response.text() || accumulated;
        emitTrace(onTrace, { type: "turn.completed", text, usage });
        return { text, usage };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitTrace(onTrace, { type: "turn.error", message: msg });
        throw new Error(`Gemini API error: ${msg}`);
      }
    }

    let result;
    try {
      result = await model.generateContent(prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Gemini API error: ${msg}`);
    }

    const text = result.response.text();
    const usageMeta = result.response.usageMetadata;
    const usage = usageMeta
      ? {
          promptTokens: usageMeta.promptTokenCount ?? 0,
          completionTokens: usageMeta.candidatesTokenCount ?? 0,
        }
      : undefined;

    return { text, usage };
  };
}
