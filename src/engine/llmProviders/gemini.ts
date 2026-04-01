import { GoogleGenerativeAI } from "@google/generative-ai";
import { LLMProvider, LLMProviderConfig, LLMResponse } from "./types";

export function createGeminiProvider(config: LLMProviderConfig): LLMProvider {
  const genAI = new GoogleGenerativeAI(config.apiKey);

  return async (prompt: string): Promise<LLMResponse> => {
    let result;
    try {
      const model = genAI.getGenerativeModel({ model: config.model });
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
