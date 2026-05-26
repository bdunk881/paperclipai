/**
 * Tier routing API client.
 *
 * Backs the Tier routing card on /connections > Models. The matrix maps the
 * three customer-visible tier keys (small / medium / large — surfaced as
 * Lite / Standard / Power) onto a `{provider, model}` binding from one of
 * the workspace's connected LLM credentials.
 *
 * Backend route: src/llmConfig/tierRoutingRoutes.ts.
 */

import { getApiBasePath } from "./baseUrl";
import { trackedFetch } from "./trackedFetch";
import type { ProviderName } from "./client";

const BASE = getApiBasePath();
const TIER_ROUTING_PATH = "/tier-routing";

export type TierKey = "small" | "medium" | "large";

export interface TierBinding {
  provider: ProviderName;
  model: string;
}

export type TierMatrix = Partial<Record<TierKey, TierBinding>>;

function authHeaders(token: string | null | undefined, extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(extra as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function getTierRouting(
  accessToken: string,
): Promise<{ matrix: TierMatrix }> {
  const res = await trackedFetch(`${BASE}${TIER_ROUTING_PATH}`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to fetch tier routing: ${res.status}`);
  }
  return (await res.json()) as { matrix: TierMatrix };
}

export async function setTierRouting(
  matrix: TierMatrix,
  accessToken: string,
): Promise<{ matrix: TierMatrix }> {
  const res = await trackedFetch(`${BASE}${TIER_ROUTING_PATH}`, {
    method: "PATCH",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ matrix }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to update tier routing: ${res.status}`);
  }
  return (await res.json()) as { matrix: TierMatrix };
}
