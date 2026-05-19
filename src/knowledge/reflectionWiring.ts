/**
 * Production LLM + embedding hooks for POST /api/knowledge/reflect (HEL-150).
 */

import { getProvider } from "../engine/llmProviders";
import { resolveModelForTier } from "../engine/llmRouter";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { resolveTier } from "../llmConfig/tierRouter";
import {
  buildResolvedFromHostedFree,
  getDefaultHostedFreeProvider,
  resolveHostedFreeApiKey,
} from "../hostedFreeModels/providers";
import { embedText } from "./embeddings";
import type { ReflectionPromptInput, ReflectionPromptOutput } from "./reflectionJob";

export interface ReflectionWorkspaceContext {
  workspaceId: string;
  userId: string;
}

async function resolveReflectionLlm(userId: string) {
  let resolved = await llmConfigStore.getDecryptedDefault(userId);
  if (!resolved) {
    const hosted = getDefaultHostedFreeProvider();
    const key = hosted ? resolveHostedFreeApiKey(hosted) : null;
    if (hosted && key) {
      resolved = buildResolvedFromHostedFree(hosted, key);
    }
  }
  return resolved;
}

function buildReflectionPrompt(input: ReflectionPromptInput): string {
  const episodeLines = input.episodes
    .map((e) => `- [${e.id}] ${e.title} (${e.createdAt}): ${e.summary}`)
    .join("\n");
  return `You are consolidating agent episode logs into one durable workspace knowledge fact.

Workspace context:
${input.workspaceContext || "(none)"}

Episodes in this cluster:
${episodeLines}

Respond with JSON only:
{
  "title": "short headline",
  "content": "2-4 sentences of durable insight",
  "missionId": "uuid or null",
  "confidence": 0.0-1.0
}`;
}

function parseReflectionOutput(raw: string): ReflectionPromptOutput | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      title?: unknown;
      content?: unknown;
      missionId?: unknown;
      confidence?: unknown;
    };
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const content = typeof parsed.content === "string" ? parsed.content.trim() : "";
    const confidence =
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0;
    const missionId =
      typeof parsed.missionId === "string" && parsed.missionId.trim()
        ? parsed.missionId.trim()
        : null;
    if (!title || !content) return null;
    return { title, content, missionId, confidence };
  } catch {
    return null;
  }
}

export async function llmReflectForWorkspace(
  ctx: ReflectionWorkspaceContext,
  input: ReflectionPromptInput,
): Promise<ReflectionPromptOutput | null> {
  const resolved = await resolveReflectionLlm(ctx.userId);
  if (!resolved) return null;

  const tier = await resolveTier({
    workspaceId: ctx.workspaceId,
    tier: "small",
  });
  const model = tier?.binding.model ?? resolveModelForTier(resolved.config.provider, "lite");

  const provider = getProvider({
    provider: resolved.config.provider,
    model,
    apiKey: resolved.apiKey,
    responseFormat: { type: "json_object" },
  });

  const response = await provider(buildReflectionPrompt(input));

  return parseReflectionOutput(response.text);
}

export async function embedTextForWorkspace(
  ctx: ReflectionWorkspaceContext,
  text: string,
): Promise<number[]> {
  const resolved = await resolveReflectionLlm(ctx.userId);
  const tier = await resolveTier({
    workspaceId: ctx.workspaceId,
    tier: "embeddings",
  });

  if (tier?.binding.provider === "openai" && resolved?.apiKey) {
    return embedText(text, resolved.apiKey);
  }

  if (resolved?.config.provider === "openai" && resolved.apiKey) {
    return embedText(text, resolved.apiKey);
  }

  return embedText(text);
}
