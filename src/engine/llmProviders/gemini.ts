import { GoogleGenerativeAI } from "@google/generative-ai";
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
): { responseMimeType: string; responseSchema?: Record<string, unknown> } | undefined {
  if (!responseFormat || responseFormat.type === "text") return undefined;
  if (responseFormat.type === "json_object") {
    return { responseMimeType: "application/json" };
  }
  return {
    responseMimeType: "application/json",
    responseSchema: responseFormat.schema,
  };
}

export function createGeminiProvider(config: LLMProviderConfig): LLMProvider {
  const apiKey = config.apiKey ?? config.credentials?.apiKey;
  if (!apiKey) {
    throw new Error(`Gemini API error: missing API key credentials for ${config.provider}`);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const generationConfig = toGeminiGenerationConfig(config.responseFormat);
  // Explicit per-request timeout — see DEFAULT_LLM_REQUEST_TIMEOUT_MS.
  // Gemini's SDK passes this through `requestOptions.timeout` to the
  // underlying fetch.
  const timeoutMs = config.requestTimeoutMs ?? DEFAULT_LLM_REQUEST_TIMEOUT_MS;

  return async (prompt: string): Promise<LLMResponse> => {
    let result;
    try {
      // The SDK's GenerationConfig type narrows responseSchema to a
      // proprietary union (FunctionDeclarationSchema) that's awkward to
      // construct from a vanilla JSON Schema object. Cast through
      // `unknown` so the wire format goes through unchanged — Gemini
      // accepts standard JSON Schema in practice.
      const modelParams = {
        model: config.model,
        ...(generationConfig ? { generationConfig } : {}),
      } as Parameters<typeof genAI.getGenerativeModel>[0];
      const model = genAI.getGenerativeModel(modelParams, { timeout: timeoutMs });
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
