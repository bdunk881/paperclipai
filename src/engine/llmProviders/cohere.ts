import { LLMProvider, LLMProviderConfig, LLMResponse } from "./types";

export function createCohereProvider(config: LLMProviderConfig): LLMProvider {
  const apiKey = config.apiKey ?? config.credentials?.apiKey;
  if (!apiKey) {
    throw new Error(`Cohere API error: missing API key credentials for ${config.provider}`);
  }

  return async (prompt: string): Promise<LLMResponse> => {
    let response: Response;
    try {
      response = await fetch("https://api.cohere.com/v2/chat", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
        }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Cohere API error: ${msg}`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Cohere API error: ${response.status} ${body}`.trim());
    }

    const payload = (await response.json()) as {
      message?: {
        content?: Array<{ type?: string; text?: string }>;
      };
      usage?: {
        tokens?: {
          input_tokens?: number;
          output_tokens?: number;
        };
      };
    };

    const text =
      payload.message?.content?.find((block) => block.type === "text")?.text ?? "";
    const usage = payload.usage?.tokens
      ? {
          promptTokens: payload.usage.tokens.input_tokens ?? 0,
          completionTokens: payload.usage.tokens.output_tokens ?? 0,
        }
      : undefined;

    return { text, usage };
  };
}
