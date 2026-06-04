import type { SubscriptionTier } from "./subscriptionStore";
import { getPostgresPool, inMemoryAllowed, isPostgresPersistenceEnabled } from "../db/postgres";

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
    // Temporarily unlocked while the hosted free-model path is built.
    // Original intent: Explore users run on a hosted free model so they
    // can try the product without supplying an API key. That hosted
    // path isn't shipped yet, and the previous false here meant
    // /api/llm-configs POST blocked Explore users at the entitlement
    // gate — the product was literally unusable on the free tier.
    // Flip back to false once the hosted-model fallback lands so the
    // free→paid conversion mechanic ("BYOK on Automate+") survives.
    byokAllowed: true,
    logRetentionDays: 14,
    approvalTierMax: 0,
  },
  flow: {
    runsPerMonth: 250,
    agentCap: 3,
    integrationCap: 3,
    // HEL-499: unified BYOK across all tiers so the ladder is monotonic.
    // Explore (free) is temporarily byok=true while the hosted-free-model
    // path is built; leaving Flow ($19) at false meant an Explore→Flow
    // upgrade *removed* BYOK — an inverted ladder. Until hosted-free ships
    // (HEL-420), every tier allows BYOK; when it lands, flip Explore back to
    // false (and reconsider gating BYOK to Automate+) in the same change.
    byokAllowed: true,
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

// DASH-48: in-memory mirror stays as a hot-path cache; canonical row
// lives in the `entitlements` Postgres table (migration 025) written by
// billingRepository.upsertSubscriptionAndEntitlements on every Stripe
// webhook. Pre-DASH-48, cache miss on `get(workspaceId)` returned
// undefined, which made `requireEntitlement.ts` silently downgrade the
// caller to "explore" until the next webhook restored the cache —
// effectively cancelling paid users' plans after every Fly restart.
// HEL-473 (B13): cache entries carry a timestamp so cross-instance plan
// changes propagate. A Stripe webhook/upgrade writes Postgres (+ that machine's
// cache) on instance A; instance B previously served its stale cached tier
// forever, so requireEntitlement enforced the wrong plan on ~half of prod
// traffic. With a TTL, B re-reads Postgres once an entry goes stale.
const ENTITLEMENTS_CACHE_TTL_MS = 30_000;
// allowlist: hot-path read cache (TTL'd); canonical state lives in Postgres (DASH-47..51 / HEL-473)
const entitlementsByWorkspace = new Map<
  string,
  { value: WorkspaceEntitlements; cachedAt: number }
>();

function postgresAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error("entitlements store requires DATABASE_URL outside development/test.");
}

interface EntitlementRow {
  workspace_id: string;
  runs_per_month: number;
  agent_cap: number;
  integration_cap: number;
  byok_allowed: boolean;
  log_retention_days: number;
  approval_tier_max: number;
  plan: SubscriptionTier;
  updated_at: Date | string;
}

function mapRow(row: EntitlementRow): WorkspaceEntitlements {
  return {
    workspaceId: row.workspace_id,
    plan: row.plan,
    runsPerMonth: row.runs_per_month,
    agentCap: row.agent_cap,
    integrationCap: row.integration_cap,
    byokAllowed: row.byok_allowed,
    logRetentionDays: row.log_retention_days,
    approvalTierMax: row.approval_tier_max,
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

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
    // The canonical Postgres write happens in
    // billingRepository.upsertSubscriptionAndEntitlements (called from
    // the same code paths that call this). This method just updates the
    // in-process cache so the next read on this machine is fast.
    const entitlements = buildEntitlements(workspaceId, plan);
    entitlementsByWorkspace.set(workspaceId, { value: entitlements, cachedAt: Date.now() });
    return entitlements;
  },

  async get(workspaceId: string): Promise<WorkspaceEntitlements | undefined> {
    const cached = entitlementsByWorkspace.get(workspaceId);
    if (cached) {
      const fresh = Date.now() - cached.cachedAt < ENTITLEMENTS_CACHE_TTL_MS;
      // In dev/test in-memory mode the cache IS canonical (no Postgres to
      // re-read from), so never expire it. In prod, serve fresh entries from
      // cache; let stale ones fall through to a Postgres re-read so a plan
      // change written on another instance propagates within the TTL.
      if (fresh || !isPostgresPersistenceEnabled()) return cached.value;
    }
    if (!postgresAvailable()) return cached?.value;

    const result = await getPostgresPool().query<EntitlementRow>(
      `SELECT workspace_id, runs_per_month, agent_cap, integration_cap,
              byok_allowed, log_retention_days, approval_tier_max, plan,
              updated_at
         FROM entitlements
        WHERE workspace_id = $1`,
      [workspaceId],
    );
    if (result.rowCount === 0) {
      // Row gone (e.g. workspace deleted) — drop any stale cache entry.
      entitlementsByWorkspace.delete(workspaceId);
      return undefined;
    }
    const entitlements = mapRow(result.rows[0]);
    entitlementsByWorkspace.set(workspaceId, { value: entitlements, cachedAt: Date.now() });
    return entitlements;
  },

  clear(): void {
    entitlementsByWorkspace.clear();
  },
};
