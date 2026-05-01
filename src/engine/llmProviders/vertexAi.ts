import { VertexAI, type GenerateContentResult, type Part } from "@google-cloud/vertexai";
import { OAuth2Client, type JWTInput } from "google-auth-library";
import { LLMProvider, LLMProviderConfig, LLMResponse } from "./types";

const GOOGLE_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

function extractText(result: GenerateContentResult): string {
  return (
    result.response.candidates?.[0]?.content.parts
      ?.flatMap((part: Part) => ("text" in part && typeof part.text === "string" ? [part.text] : []))
      .join("") ?? ""
  );
}

function parseServiceAccountJson(serviceAccountJson: string): JWTInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error("Vertex AI API error: invalid serviceAccountJson");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Vertex AI API error: invalid serviceAccountJson");
  }

  const credentials = parsed as JWTInput;
  if (typeof credentials.client_email !== "string" || typeof credentials.private_key !== "string") {
    throw new Error("Vertex AI API error: serviceAccountJson must include client_email and private_key");
  }

  return credentials;
}

function resolveGoogleAuthOptions(config: LLMProviderConfig) {
  if (config.credentials?.serviceAccountJson) {
    return {
      credentials: parseServiceAccountJson(config.credentials.serviceAccountJson),
      scopes: GOOGLE_CLOUD_PLATFORM_SCOPE,
    };
  }

  if (config.credentials?.oauthAccessToken) {
    const authClient = new OAuth2Client();
    authClient.setCredentials({ access_token: config.credentials.oauthAccessToken });
    return {
      authClient: authClient as never,
      scopes: GOOGLE_CLOUD_PLATFORM_SCOPE,
    };
  }

  throw new Error(`Vertex AI API error: missing Google Cloud credentials for ${config.provider}`);
}

export function createVertexAIProvider(config: LLMProviderConfig): LLMProvider {
  const project = config.options?.projectId;
  const location = config.options?.location;

  if (!project || !location) {
    throw new Error(`Vertex AI API error: missing projectId/location for ${config.provider}`);
  }

  const vertexAI = new VertexAI({
    project,
    location,
    ...(config.options?.endpoint ? { apiEndpoint: config.options.endpoint } : {}),
    googleAuthOptions: resolveGoogleAuthOptions(config),
  });
  const model = vertexAI.getGenerativeModel({ model: config.model });

  return async (prompt: string): Promise<LLMResponse> => {
    let result;
    try {
      result = await model.generateContent(prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Vertex AI API error: ${msg}`);
    }

    const usageMeta = result.response.usageMetadata;
    const usage = usageMeta
      ? {
          promptTokens: usageMeta.promptTokenCount ?? 0,
          completionTokens: usageMeta.candidatesTokenCount ?? 0,
        }
      : undefined;

    return {
      text: extractText(result),
      usage,
    };
  };
}
