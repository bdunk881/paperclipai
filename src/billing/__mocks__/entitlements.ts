/**
 * HEL-71: Jest auto-mock for the entitlements module.
 *
 * Test files opt in with:
 *
 *   jest.mock("../billing/entitlements");        // any depth
 *
 * Behavior:
 *   - `entitlementStore.get(workspaceId)` returns a workspace entitled to
 *     the "automate" tier by default. Every gated feature passes; quota
 *     features are set high enough that no test hits them accidentally.
 *   - Tests that need to exercise the denial path import the real
 *     `entitlementStore.upsert(...)` to override the default with a lower
 *     tier ("explore") and assert the 402 payload.
 *
 * The real module persists into an in-memory Map; this mock returns the
 * canned object directly without persisting, so each test stays isolated.
 *
 * Re-exports types from the real module so test code that imports the types
 * still typechecks.
 */

export type { WorkspaceEntitlements, EntitlementLimits } from "../entitlements";
import type { WorkspaceEntitlements, EntitlementLimits } from "../entitlements";
import type { SubscriptionTier } from "../subscriptionStore";

const AUTOMATE_LIMITS: EntitlementLimits = {
  runsPerMonth: 1000,
  agentCap: 10,
  integrationCap: 10,
  byokAllowed: true,
  logRetentionDays: 90,
  approvalTierMax: 2,
};

// Per-workspace plan overrides for the active test. Cleared between tests
// (via the test's own beforeEach/afterEach) — tests that need a specific
// tier call `entitlementStore.upsert(workspaceId, "explore")` and the mock
// records it here.
const overrides = new Map<string, SubscriptionTier>();

function build(workspaceId: string, plan: SubscriptionTier): WorkspaceEntitlements {
  const limits: EntitlementLimits =
    plan === "automate"
      ? AUTOMATE_LIMITS
      : plan === "scale"
        ? {
            runsPerMonth: 10000,
            agentCap: 50,
            integrationCap: 25,
            byokAllowed: true,
            logRetentionDays: 365,
            approvalTierMax: 3,
          }
        : plan === "flow"
          ? {
              runsPerMonth: 250,
              agentCap: 3,
              integrationCap: 3,
              byokAllowed: false,
              logRetentionDays: 30,
              approvalTierMax: 1,
            }
          : {
              runsPerMonth: 25,
              agentCap: 1,
              integrationCap: 1,
              byokAllowed: false,
              logRetentionDays: 14,
              approvalTierMax: 0,
            };

  return {
    workspaceId,
    plan,
    ...limits,
    updatedAt: new Date().toISOString(),
  };
}

export function getEntitlementLimits(plan: SubscriptionTier): EntitlementLimits {
  return build("__test__", plan);
}

export function buildEntitlements(
  workspaceId: string,
  plan: SubscriptionTier,
): WorkspaceEntitlements {
  return build(workspaceId, plan);
}

export const entitlementStore = {
  upsert(workspaceId: string, plan: SubscriptionTier): WorkspaceEntitlements {
    overrides.set(workspaceId, plan);
    return build(workspaceId, plan);
  },

  get(workspaceId: string): WorkspaceEntitlements | undefined {
    const plan = overrides.get(workspaceId) ?? "automate";
    return build(workspaceId, plan);
  },

  clear(): void {
    overrides.clear();
  },
};
