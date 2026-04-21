import { LLMProvider, LLMProviderConfig } from "./types";
import { createOpenAICompatibleProvider } from "./openaiCompatible";

export function createOpenAIProvider(config: LLMProviderConfig): LLMProvider {
  return createOpenAICompatibleProvider(config, { label: "OpenAI" });
}
