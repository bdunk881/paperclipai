import { getApiBasePath } from "./baseUrl";

const BASE = getApiBasePath();

export type SubscriptionTier = "flow" | "automate" | "scale";
export type SubscriptionAccessLevel = "none" | "full" | "limited" | string;

export interface WorkspaceSubscription {
  id: string;
  tier: SubscriptionTier;
  status: string;
  accessLevel: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEnd?: string | null;
}

export interface SubscriptionStatusResponse {
  subscription: WorkspaceSubscription | null;
  accessLevel: SubscriptionAccessLevel;
}

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

/** GET /api/billing/subscription */
export async function getWorkspaceSubscription(
  accessToken: string,
): Promise<SubscriptionStatusResponse> {
  const res = await fetch(`${BASE}/billing/subscription`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `Failed to load subscription: ${res.status}`);
  }
  return res.json() as Promise<SubscriptionStatusResponse>;
}

export function formatSubscriptionTierLabel(tier: SubscriptionTier): string {
  switch (tier) {
    case "flow":
      return "Flow";
    case "automate":
      return "Automate";
    case "scale":
      return "Scale";
    default:
      return tier;
  }
}
