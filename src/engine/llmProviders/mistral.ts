import { Mistral } from "@mistralai/mistralai";
import { LLMProvider, LLMProviderConfig, LLMResponse, ResponseFormat } from "./types";

/**
 * Convert our provider-agnostic ResponseFormat into Mistral's
 * `responseFormat` shape. Mistral's API:
 *   - `{ type: "json_object" }` — JSON-mode, no schema.
 *   - `{ type: "json_schema", jsonSchema: {…} }` — strict schema mode
 *     (mistral-large-latest and newer).
 *
 * The Mistral SDK accepts a loose shape; we cast it through `unknown`
 * to keep the type bridge contained in this one helper rather than
 * polluting the call site.
 */
function toMistralResponseFormat(
  responseFormat: ResponseFormat | undefined,
): unknown {
  if (!responseFormat || responseFormat.type === "text") return undefined;
  if (responseFormat.type === "json_object") {
    return { type: "json_object" };
  }
  return {
    type: "json_schema",
    jsonSchema: {
      name: responseFormat.name ?? "response",
      schemaDefinition: responseFormat.schema,
      strict: true,
    },
  };
}

/**
 * Mistral SDK request timeout. Defaults to 120 s because the
 * team-assembly prompt is heavy (full role library + structured JSON
 * schema in the prompt body, structured JSON output) and
 * `mistral-large-latest` under load routinely runs 20-60 s end-to-end.
 *
 * Pre-fix we relied on the SDK's underlying fetch default, which on
 * Fly.io's Node runtime aborts well before that — the user saw a fast
 * "Mistral API error: Request timed out: TimeoutError" with no path
 * forward. 120 s is comfortably above observed p99 for the heaviest
 * call site while still keeping a hung backend from spinning forever.
 */
const MISTRAL_REQUEST_TIMEOUT_MS = 120_000;

export function createMistralProvider(config: LLMProviderConfig): LLMProvider {
  const apiKey = config.apiKey ?? config.credentials?.apiKey;
  if (!apiKey) {
    throw new Error(`Mistral API error: missing API key credentials for ${config.provider}`);
  }

  const client = new Mistral({ apiKey, timeoutMs: MISTRAL_REQUEST_TIMEOUT_MS });
  const responseFormat = toMistralResponseFormat(config.responseFormat);

  return async (prompt: string): Promise<LLMResponse> => {
    let response;
    try {
      response = await client.chat.complete({
        model: config.model,
        messages: [{ role: "user", content: prompt }],
        // The Mistral SDK's typed surface lags its public API. Casting
        // through `unknown` lets us pass `responseFormat` for both
        // json_object and json_schema modes without forking the SDK
        // types — the wire format matches the docs at
        // https://docs.mistral.ai/capabilities/structured-output.
        ...(responseFormat
          ? ({ responseFormat } as unknown as Record<string, unknown>)
          : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Mistral API error: ${msg}`);
    }

    const text =
      (response.choices?.[0]?.message?.content as string | null | undefined) ?? "";
    const usage =
      response.usage &&
      response.usage.promptTokens !== undefined &&
      response.usage.completionTokens !== undefined
        ? {
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
          }
        : undefined;

    return { text, usage };
  };
}
