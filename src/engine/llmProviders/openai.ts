import OpenAI from "openai";
import { LLMProvider, LLMProviderConfig, LLMResponse } from "./types";

export function createOpenAIProvider(config: LLMProviderConfig): LLMProvider {
  const client = new OpenAI({ apiKey: config.apiKey });

  return async (prompt: string): Promise<LLMResponse> => {
    let response;
    const request: Record<string, unknown> = {
      model: config.model,
      messages: [{ role: "user", content: prompt }],
    };
    if (config.inferenceGeo) {
      request.inference_geo = config.inferenceGeo;
    }
    try {
      response = await client.chat.completions.create(request as never);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`OpenAI API error: ${msg}`);
    }

    const text = response.choices[0]?.message?.content ?? "";
    const usage = response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
        }
      : undefined;

    return { text, usage };
  };
}
