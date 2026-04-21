/**
 * Express routes for /api/llm-configs.
 * Provides CRUD operations for user LLM provider credentials.
 * Secrets are stored encrypted at rest and never returned in plaintext.
 */

import { Router, Response } from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import {
  LLMProviderCredentials,
  LLMProviderOptions,
  PROVIDER_NAMES,
} from "../engine/llmProviders/types";
import { llmConfigStore, LLMProvider } from "./llmConfigStore";

const VALID_PROVIDERS: LLMProvider[] = [...PROVIDER_NAMES];
const API_KEY_PROVIDERS = new Set<LLMProvider>([
  "openai",
  "anthropic",
  "gemini",
  "mistral",
  "groq",
  "fireworks",
  "together",
  "ollama",
  "localai",
  "cohere",
  "perplexity",
  "xai",
  "deepseek",
]);

function getUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  if (typeof userId !== "string" || !userId.trim()) {
    return null;
  }
  return userId;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeProviderOptions(value: unknown): LLMProviderOptions | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  const providerOptions: LLMProviderOptions = {};

  const endpoint = normalizeString(input.endpoint);
  const deployment = normalizeString(input.deployment);
  const apiVersion = normalizeString(input.apiVersion);
  const region = normalizeString(input.region);
  const projectId = normalizeString(input.projectId);
  const location = normalizeString(input.location);
  const authType = normalizeString(input.authType);

  if (endpoint) providerOptions.endpoint = endpoint;
  if (deployment) providerOptions.deployment = deployment;
  if (apiVersion) providerOptions.apiVersion = apiVersion;
  if (region) providerOptions.region = region;
  if (projectId) providerOptions.projectId = projectId;
  if (location) providerOptions.location = location;
  if (
    authType === "api_key" ||
    authType === "aws" ||
    authType === "service_account" ||
    authType === "oauth"
  ) {
    providerOptions.authType = authType;
  }

  return Object.keys(providerOptions).length > 0 ? providerOptions : undefined;
}

function normalizeCredentials(
  credentialsValue: unknown,
  apiKeyValue: unknown
): LLMProviderCredentials | null {
  if (
    credentialsValue !== undefined &&
    (typeof credentialsValue !== "object" ||
      credentialsValue === null ||
      Array.isArray(credentialsValue))
  ) {
    return null;
  }

  const input = (credentialsValue as Record<string, unknown> | undefined) ?? {};
  const credentials: LLMProviderCredentials = {};

  const apiKey = normalizeString(apiKeyValue) ?? normalizeString(input.apiKey);
  const accessKeyId = normalizeString(input.accessKeyId);
  const secretAccessKey = normalizeString(input.secretAccessKey);
  const sessionToken = normalizeString(input.sessionToken);
  const serviceAccountJson = normalizeString(input.serviceAccountJson);
  const oauthAccessToken = normalizeString(input.oauthAccessToken);

  if (apiKey) credentials.apiKey = apiKey;
  if (accessKeyId) credentials.accessKeyId = accessKeyId;
  if (secretAccessKey) credentials.secretAccessKey = secretAccessKey;
  if (sessionToken) credentials.sessionToken = sessionToken;
  if (serviceAccountJson) credentials.serviceAccountJson = serviceAccountJson;
  if (oauthAccessToken) credentials.oauthAccessToken = oauthAccessToken;

  return credentials;
}

function validateProviderConfig(params: {
  provider: LLMProvider;
  model: string;
  credentials: LLMProviderCredentials;
  providerOptions?: LLMProviderOptions;
}): string | null {
  const { provider, model, credentials, providerOptions } = params;

  if (!model.trim()) {
    return "model is required";
  }

  if (API_KEY_PROVIDERS.has(provider)) {
    if (!credentials.apiKey || credentials.apiKey.length < 4) {
      return "apiKey is required (minimum 4 characters)";
    }
    return null;
  }

  if (provider === "azure-openai") {
    if (!credentials.apiKey || credentials.apiKey.length < 4) {
      return "azure-openai requires apiKey (minimum 4 characters)";
    }
    if (!providerOptions?.endpoint) {
      return "azure-openai requires providerOptions.endpoint";
    }
    if (!providerOptions.deployment) {
      return "azure-openai requires providerOptions.deployment";
    }
    return null;
  }

  if (provider === "bedrock") {
    if (!credentials.accessKeyId || !credentials.secretAccessKey) {
      return "bedrock requires credentials.accessKeyId and credentials.secretAccessKey";
    }
    if (!providerOptions?.region) {
      return "bedrock requires providerOptions.region";
    }
    return null;
  }

  if (provider === "vertex-ai") {
    if (!providerOptions?.projectId || !providerOptions.location) {
      return "vertex-ai requires providerOptions.projectId and providerOptions.location";
    }
    if (!credentials.serviceAccountJson && !credentials.oauthAccessToken) {
      return "vertex-ai requires credentials.serviceAccountJson or credentials.oauthAccessToken";
    }
    return null;
  }

  return null;
}

const router = Router();

router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const { provider, label, model, apiKey, credentials, providerOptions } =
    req.body as Record<string, unknown>;

  if (
    typeof provider !== "string" ||
    !VALID_PROVIDERS.includes(provider as LLMProvider)
  ) {
    res
      .status(400)
      .json({ error: `provider must be one of: ${VALID_PROVIDERS.join(", ")}` });
    return;
  }

  const normalizedLabel = normalizeString(label);
  if (!normalizedLabel) {
    res.status(400).json({ error: "label is required" });
    return;
  }

  const normalizedModel = normalizeString(model);
  if (!normalizedModel) {
    res.status(400).json({ error: "model is required" });
    return;
  }

  const normalizedCredentials = normalizeCredentials(credentials, apiKey);
  if (!normalizedCredentials) {
    res.status(400).json({ error: "credentials must be an object when provided" });
    return;
  }

  const normalizedOptions = normalizeProviderOptions(providerOptions);
  const validationError = validateProviderConfig({
    provider: provider as LLMProvider,
    model: normalizedModel,
    credentials: normalizedCredentials,
    providerOptions: normalizedOptions,
  });

  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const config = await llmConfigStore.createAsync({
    userId,
    provider: provider as LLMProvider,
    label: normalizedLabel,
    model: normalizedModel,
    credentials: normalizedCredentials,
    providerOptions: normalizedOptions,
  });

  res.status(201).json(config);
});

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const configs = await llmConfigStore.listAsync(userId);
  res.json({ configs, total: configs.length });
});

router.patch("/:id/default", async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const updated = await llmConfigStore.setDefaultAsync(req.params.id, userId);
  if (!updated) {
    res.status(404).json({ error: `LLM config not found: ${req.params.id}` });
    return;
  }

  res.json(updated);
});

router.patch("/:id", async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const existing = await llmConfigStore.getAsync(req.params.id, userId);
  if (!existing) {
    res.status(404).json({ error: `LLM config not found: ${req.params.id}` });
    return;
  }

  const { label, model, apiKey, credentials, providerOptions } =
    req.body as Record<string, unknown>;

  const patch: Partial<{
    label: string;
    model: string;
    credentials: LLMProviderCredentials;
    providerOptions?: LLMProviderOptions;
  }> = {};

  if (label !== undefined) {
    const normalizedLabel = normalizeString(label);
    if (!normalizedLabel) {
      res.status(400).json({ error: "label must be a non-empty string" });
      return;
    }
    patch.label = normalizedLabel;
  }

  if (model !== undefined) {
    const normalizedModel = normalizeString(model);
    if (!normalizedModel) {
      res.status(400).json({ error: "model must be a non-empty string" });
      return;
    }
    patch.model = normalizedModel;
  }

  if (credentials !== undefined || apiKey !== undefined) {
    const normalizedCredentials = normalizeCredentials(credentials, apiKey);
    if (!normalizedCredentials) {
      res.status(400).json({ error: "credentials must be an object when provided" });
      return;
    }
    patch.credentials = normalizedCredentials;
  }

  if (providerOptions !== undefined) {
    patch.providerOptions = normalizeProviderOptions(providerOptions);
  }

  const validationError = validateProviderConfig({
    provider: existing.provider,
    model: patch.model ?? existing.model,
    credentials:
      patch.credentials ??
      (await llmConfigStore.getDecryptedAsync(req.params.id, userId))?.credentials ??
      {},
    providerOptions: patch.providerOptions ?? existing.providerOptions,
  });

  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const updated = llmConfigStore.update(req.params.id, userId, patch);
  if (!updated) {
    res.status(404).json({ error: `LLM config not found: ${req.params.id}` });
    return;
  }

  res.json(updated);
});

router.delete("/:id", async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const deleted = await llmConfigStore.deleteAsync(req.params.id, userId);
  if (!deleted) {
    res.status(404).json({ error: `LLM config not found: ${req.params.id}` });
    return;
  }

  res.status(204).send();
});

export default router;
