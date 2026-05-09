import type { SubscriptionTier } from "./subscriptionStore";

export interface WorkspaceEntitlements {
  workspaceId: string;
  plan: SubscriptionTier;
  runsPerMonth: number;
  agentCap: number;
  integrationCap: number;
  byokAllowed: boolean;
  logRetentionDays: number;
  approvalTierMax: number;
  updatedAt: string;
}

export interface EntitlementLimits {
  runsPerMonth: number;
  agentCap: number;
  integrationCap: number;
  byokAllowed: boolean;
  logRetentionDays: number;
  approvalTierMax: number;
}

const PLAN_LIMITS: Record<SubscriptionTier, EntitlementLimits> = {
  explore: {
    runsPerMonth: 25,
    agentCap: 1,
    integrationCap: 1,
    byokAllowed: false,
    logRetentionDays: 14,
    approvalTierMax: 0,
  },
  flow: {
    runsPerMonth: 250,
    agentCap: 3,
    integrationCap: 3,
    byokAllowed: false,
    logRetentionDays: 30,
    approvalTierMax: 1,
  },
  automate: {
    runsPerMonth: 1000,
    agentCap: 10,
    integrationCap: 10,
    byokAllowed: true,
    logRetentionDays: 90,
    approvalTierMax: 2,
  },
  scale: {
    runsPerMonth: 10000,
    agentCap: 50,
    integrationCap: 25,
    byokAllowed: true,
    logRetentionDays: 365,
    approvalTierMax: 3,
  },
};

const entitlementsByWorkspace = new Map<string, WorkspaceEntitlements>();

export function getEntitlementLimits(plan: SubscriptionTier): EntitlementLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.explore;
}

export function buildEntitlements(workspaceId: string, plan: SubscriptionTier): WorkspaceEntitlements {
  return {
    workspaceId,
    plan,
    ...getEntitlementLimits(plan),
    updatedAt: new Date().toISOString(),
  };
}

export const entitlementStore = {
  upsert(workspaceId: string, plan: SubscriptionTier): WorkspaceEntitlements {
    const entitlements = buildEntitlements(workspaceId, plan);
    entitlementsByWorkspace.set(workspaceId, entitlements);
    return entitlements;
  },

  get(workspaceId: string): WorkspaceEntitlements | undefined {
    return entitlementsByWorkspace.get(workspaceId);
  },

  clear(): void {
    entitlementsByWorkspace.clear();
  },
};
