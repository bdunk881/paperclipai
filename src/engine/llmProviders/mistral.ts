import { Mistral } from "@mistralai/mistralai";
import { LLMProvider, LLMProviderConfig, LLMResponse } from "./types";

export function createMistralProvider(config: LLMProviderConfig): LLMProvider {
  const client = new Mistral({ apiKey: config.apiKey });

  return async (prompt: string): Promise<LLMResponse> => {
    let response;
    try {
      response = await client.chat.complete({
        model: config.model,
        messages: [{ role: "user", content: prompt }],
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
