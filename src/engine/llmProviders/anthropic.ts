import Anthropic from "@anthropic-ai/sdk";
import { LLMProvider, LLMProviderConfig, LLMResponse } from "./types";

export function createAnthropicProvider(config: LLMProviderConfig): LLMProvider {
  const client = new Anthropic({ apiKey: config.apiKey });

  return async (prompt: string): Promise<LLMResponse> => {
    let response;
    try {
      response = await client.messages.create({
        model: config.model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Anthropic API error: ${msg}`);
    }

    const firstBlock = response.content[0];
    const text = firstBlock?.type === "text" ? firstBlock.text : "";
    const usage = {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
    };

    return { text, usage };
  };
}
