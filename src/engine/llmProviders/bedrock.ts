import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ConverseOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { LLMProvider, LLMProviderConfig, LLMResponse } from "./types";

function extractMessageContent(output: ConverseOutput | undefined): ContentBlock[] {
  if (!output || !("message" in output) || !output.message) {
    return [];
  }
  return output.message.content ?? [];
}

function extractText(content: ContentBlock[]): string {
  return content
    .flatMap((block) => ("text" in block && typeof block.text === "string" ? [block.text] : []))
    .join("");
}

export function createBedrockProvider(config: LLMProviderConfig): LLMProvider {
  const accessKeyId = config.credentials?.accessKeyId;
  const secretAccessKey = config.credentials?.secretAccessKey;
  const sessionToken = config.credentials?.sessionToken;
  const region = config.options?.region;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(`AWS Bedrock API error: missing AWS credentials for ${config.provider}`);
  }
  if (!region) {
    throw new Error(`AWS Bedrock API error: missing region for ${config.provider}`);
  }

  const client = new BedrockRuntimeClient({
    region,
    ...(config.options?.endpoint ? { endpoint: config.options.endpoint } : {}),
    credentials: {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    },
  });

  return async (prompt: string): Promise<LLMResponse> => {
    let response;
    try {
      response = await client.send(
        new ConverseCommand({
          modelId: config.model,
          messages: [
            {
              role: "user",
              content: [{ text: prompt }],
            },
          ],
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`AWS Bedrock API error: ${msg}`);
    }

    const text = extractText(extractMessageContent(response.output));
    const usage = response.usage
      ? {
          promptTokens: response.usage.inputTokens ?? 0,
          completionTokens: response.usage.outputTokens ?? 0,
        }
      : undefined;

    return { text, usage };
  };
}
