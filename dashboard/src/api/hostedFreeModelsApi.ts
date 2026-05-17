/**
 * Hosted free model catalog client (PR B.3).
 *
 * Mirrors the GET /api/hosted-free-models endpoint shape from
 * src/hostedFreeModels/hostedFreeRoutes.ts. Powers the LLM Providers
 * page's hosted-free section: the catalog of 3 tiers + the active
 * workspace's daily token usage.
 */

import { getApiBasePath } from "./baseUrl";
import { trackedFetch } from "./trackedFetch";

const BASE = getApiBasePath();

export interface HostedFreeProvider {
  id: string;
  tier: number;
  label: string;
  description: string;
  provider: string;
  modelId: string;
  warnings: string[];
  available: boolean;
  isDefault: boolean;
}

export interface HostedFreeUsage {
  workspaceId: string | null;
  dayKey: string | null;
  usedTokens: number;
  capTokens: number;
  remainingTokens: number;
  warning: boolean;
  exceeded: boolean;
}

export interface HostedFreeCatalog {
  providers: HostedFreeProvider[];
  defaultProviderId: string;
  usage: HostedFreeUsage;
}

export async function getHostedFreeCatalog(
  accessToken: string,
): Promise<HostedFreeCatalog> {
  const response = await trackedFetch(`${BASE}/hosted-free-models`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(
      payload?.error ?? `Failed to load hosted free models: ${response.status}`,
    );
  }
  return response.json() as Promise<HostedFreeCatalog>;
}
