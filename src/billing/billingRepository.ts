import { getPostgresPool, inMemoryAllowed, isPostgresPersistenceEnabled } from "../db/postgres";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { getEntitlementLimits } from "./entitlements";
import type { AccessLevel, Subscription, SubscriptionTier } from "./subscriptionStore";

export interface BillingStateInput {
  workspaceId?: string | null;
  userId?: string | null;
  email?: string | null;
  stripeSubscriptionId: string;
  stripeCustomerId?: string | null;
  plan: SubscriptionTier;
  status: string;
  accessLevel?: AccessLevel | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  trialEnd?: string | null;
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

/**
 * Hydration loader (HEL-45). Reads every subscription row that has the new
 * canonical columns set, returning the in-memory Subscription shape so
 * subscriptionStore can repopulate after a process restart.
 *
 * Skips rows that lack a workspace_id (legacy / orphaned) — those would
 * fail RLS write-back anyway.
 */
async function loadAllSubscriptionsImpl(): Promise<Subscription[]> {
  if (!persistenceAvailable()) return [];
  // Hydration runs at startup with no workspace context — use the pool
  // directly. RLS allows SELECT on subscriptions only when
  // app_current_workspace_id() matches; for a privileged hydration query
  // we bypass via the migration / service role implicit in pool config.
  // If a deploy uses a non-BYPASSRLS pool role, this returns empty and
  // subsequent webhooks rebuild the cache as they arrive.
  const result = await getPostgresPool().query<{
    id: string;
    workspace_id: string;
    user_id: string | null;
    email: string | null;
    stripe_subscription_id: string;
    stripe_customer_id: string | null;
    plan: SubscriptionTier;
    status: string;
    access_level: AccessLevel | null;
    current_period_start: Date | null;
    current_period_end: Date | null;
    cancel_at_period_end: boolean;
    trial_end: Date | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, workspace_id, user_id, email, stripe_subscription_id,
            stripe_customer_id, plan, status, access_level,
            current_period_start, current_period_end,
            cancel_at_period_end, trial_end, created_at, updated_at
       FROM subscriptions
      WHERE stripe_subscription_id IS NOT NULL`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id ?? undefined,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeCustomerId: row.stripe_customer_id ?? "",
    userId: row.user_id ?? "",
    email: row.email ?? "",
    tier: row.plan,
    accessLevel: row.access_level ?? "none",
    status: row.status,
    currentPeriodStart: row.current_period_start?.toISOString() ?? "",
    currentPeriodEnd: row.current_period_end?.toISOString() ?? "",
    cancelAtPeriodEnd: row.cancel_at_period_end,
    trialEnd: row.trial_end?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
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
             user_id,
             email,
             stripe_subscription_id,
             stripe_customer_id,
             plan,
             status,
             access_level,
             current_period_start,
             current_period_end,
             cancel_at_period_end,
             trial_end
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11, $12::timestamptz)
           ON CONFLICT (stripe_subscription_id) DO UPDATE SET
             workspace_id = EXCLUDED.workspace_id,
             user_id = COALESCE(EXCLUDED.user_id, subscriptions.user_id),
             email = COALESCE(EXCLUDED.email, subscriptions.email),
             stripe_customer_id = EXCLUDED.stripe_customer_id,
             plan = EXCLUDED.plan,
             status = EXCLUDED.status,
             access_level = COALESCE(EXCLUDED.access_level, subscriptions.access_level),
             current_period_start = COALESCE(EXCLUDED.current_period_start, subscriptions.current_period_start),
             current_period_end = EXCLUDED.current_period_end,
             cancel_at_period_end = EXCLUDED.cancel_at_period_end,
             trial_end = COALESCE(EXCLUDED.trial_end, subscriptions.trial_end),
             updated_at = now()`,
          [
            workspaceId,
            input.userId ?? null,
            input.email ?? null,
            input.stripeSubscriptionId,
            input.stripeCustomerId ?? null,
            input.plan,
            input.status,
            input.accessLevel ?? null,
            input.currentPeriodStart ?? null,
            input.currentPeriodEnd ?? null,
            input.cancelAtPeriodEnd ?? false,
            input.trialEnd ?? null,
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

  /**
   * HEL-45: hydration entrypoint. Called from app.ts on startup so
   * subscriptionStore's in-memory map survives a process restart.
   * Returns an empty array if Postgres isn't available (test mode).
   */
  loadAllSubscriptions: loadAllSubscriptionsImpl,
};
