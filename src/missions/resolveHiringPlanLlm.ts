import { llmConfigStore, type DecryptedLLMConfig } from "../llmConfig/llmConfigStore";
import {
  buildResolvedFromHostedFree,
  getDefaultHostedFreeProvider,
  getHostedFreeProviderById,
  HOSTED_FREE_PROVIDERS,
  resolveHostedFreeApiKey,
} from "../hostedFreeModels/providers";

const HOSTED_FREE_PREFIX = "hosted-free:";

export function hostedFreeLlmConfigId(providerId: string): string {
  return `${HOSTED_FREE_PREFIX}${providerId}`;
}

export function isHostedFreeLlmConfigId(id: string): boolean {
  return id.startsWith(HOSTED_FREE_PREFIX);
}

export function parseHostedFreeLlmConfigId(id: string): string | null {
  if (!isHostedFreeLlmConfigId(id)) return null;
  return id.slice(HOSTED_FREE_PREFIX.length);
}

export interface ResolvedHiringPlanLlm {
  resolved: DecryptedLLMConfig;
  llmConfigId: string | null;
  assemblyModel: string;
}

export async function resolveHiringPlanLlm(
  userId: string,
  llmConfigId?: string | null,
): Promise<ResolvedHiringPlanLlm | null> {
  if (llmConfigId) {
    if (isHostedFreeLlmConfigId(llmConfigId)) {
      const providerId = parseHostedFreeLlmConfigId(llmConfigId);
      if (!providerId) return null;
      const hosted = getHostedFreeProviderById(providerId);
      const key = hosted ? resolveHostedFreeApiKey(hosted) : null;
      if (!hosted || !key) return null;
      const resolved = buildResolvedFromHostedFree(hosted, key);
      return {
        resolved,
        llmConfigId,
        assemblyModel: hosted.modelId,
      };
    }

    const resolved = await llmConfigStore.getDecryptedAsync(llmConfigId, userId);
    if (!resolved) return null;
    return {
      resolved,
      llmConfigId,
      assemblyModel: resolved.config.model,
    };
  }

  const byokConfigs = await llmConfigStore.listAsync(userId);
  if (byokConfigs.length > 0) {
    const resolved = await llmConfigStore.getDecryptedDefaultAsync(userId);
    if (!resolved) return null;
    return {
      resolved,
      llmConfigId: resolved.config.id,
      assemblyModel: resolved.config.model,
    };
  }

  const hostedFree = getDefaultHostedFreeProvider();
  const hostedFreeKey = hostedFree ? resolveHostedFreeApiKey(hostedFree) : null;
  if (hostedFree && hostedFreeKey) {
    const resolved = buildResolvedFromHostedFree(hostedFree, hostedFreeKey);
    return {
      resolved,
      llmConfigId: hostedFreeLlmConfigId(hostedFree.id),
      assemblyModel: hostedFree.modelId,
    };
  }

  return null;
}

/** IDs the Hire page may pass to generate-plan (BYOK rows + hosted-free when allowed). */
export async function listSelectableHiringPlanLlmIds(userId: string): Promise<string[]> {
  const byok = await llmConfigStore.listAsync(userId);
  const ids = byok.map((cfg) => cfg.id);
  if (byok.length > 0) {
    return ids;
  }
  return HOSTED_FREE_PROVIDERS.filter((p) => resolveHostedFreeApiKey(p)).map((p) =>
    hostedFreeLlmConfigId(p.id),
  );
}
