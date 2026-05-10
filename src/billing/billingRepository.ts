import { getPostgresPool, inMemoryAllowed, isPostgresPersistenceEnabled } from "../db/postgres";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { getEntitlementLimits } from "./entitlements";
import type { SubscriptionTier } from "./subscriptionStore";

export interface BillingStateInput {
  workspaceId?: string | null;
  userId?: string | null;
  stripeSubscriptionId: string;
  stripeCustomerId?: string | null;
  plan: SubscriptionTier;
  status: string;
  currentPeriodEnd?: string | null;
}

function persistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) {
    return true;
  }
  if (inMemoryAllowed()) {
    return false;
  }
  throw new Error("billing persistence requires DATABASE_URL outside development/test.");
}

export function effectiveEntitlementPlan(plan: SubscriptionTier, status: string): SubscriptionTier {
  return status === "active" || status === "trialing" ? plan : "explore";
}

export const billingRepository = {
  async upsertSubscriptionAndEntitlements(input: BillingStateInput): Promise<void> {
    const workspaceId = input.workspaceId?.trim();
    if (!workspaceId || !persistenceAvailable()) {
      return;
    }

    const userId = input.userId?.trim() || "stripe-webhook";
    const entitlementPlan = effectiveEntitlementPlan(input.plan, input.status);
    const limits = getEntitlementLimits(entitlementPlan);

    await withWorkspaceContext(
      getPostgresPool(),
      { workspaceId, userId },
      async (client) => {
        await client.query(
          `INSERT INTO subscriptions (
             workspace_id,
             stripe_subscription_id,
             stripe_customer_id,
             plan,
             status,
             current_period_end
           ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
           ON CONFLICT (stripe_subscription_id) DO UPDATE SET
             workspace_id = EXCLUDED.workspace_id,
             stripe_customer_id = EXCLUDED.stripe_customer_id,
             plan = EXCLUDED.plan,
             status = EXCLUDED.status,
             current_period_end = EXCLUDED.current_period_end,
             updated_at = now()`,
          [
            workspaceId,
            input.stripeSubscriptionId,
            input.stripeCustomerId ?? null,
            input.plan,
            input.status,
            input.currentPeriodEnd ?? null,
          ],
        );

        await client.query(
          `INSERT INTO entitlements (
             workspace_id,
             runs_per_month,
             agent_cap,
             integration_cap,
             byok_allowed,
             log_retention_days,
             approval_tier_max,
             plan
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (workspace_id) DO UPDATE SET
             runs_per_month = EXCLUDED.runs_per_month,
             agent_cap = EXCLUDED.agent_cap,
             integration_cap = EXCLUDED.integration_cap,
             byok_allowed = EXCLUDED.byok_allowed,
             log_retention_days = EXCLUDED.log_retention_days,
             approval_tier_max = EXCLUDED.approval_tier_max,
             plan = EXCLUDED.plan,
             updated_at = now()`,
          [
            workspaceId,
            limits.runsPerMonth,
            limits.agentCap,
            limits.integrationCap,
            limits.byokAllowed,
            limits.logRetentionDays,
            limits.approvalTierMax,
            entitlementPlan,
          ],
        );
      },
    );
  },
};
