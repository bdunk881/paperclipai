/**
 * Entitlement-gating middleware (HEL-22).
 *
 * Composes after `withWorkspace`: the chokepoint resolves the workspace,
 * this middleware then checks the workspace's entitlements (per the active
 * Stripe subscription tier) before allowing the action.
 *
 *   app.use(
 *     "/api/llm-configs",
 *     requireAuth,
 *     withWorkspace(pool),
 *     requireEntitlement("byokAllowed"),
 *     llmConfigRoutes,
 *   );
 *
 *   app.post(
 *     "/api/agents",
 *     requireAuth,
 *     withWorkspace(pool),
 *     requireEntitlement("agentCap", { getCurrent: (req) => agentStore.countByWorkspace(req.workspace!.id) }),
 *     handler,
 *   );
 *
 * Error shape — every gated rejection carries the same machine-readable
 * payload so the dashboard can render a consistent "Upgrade to <tier>" CTA:
 *
 *   {
 *     error: "Plan limit reached: <feature>",
 *     code: "entitlement_exceeded",
 *     feature: "<feature name>",
 *     limit: <number | boolean>,
 *     current: <number | undefined>,
 *     upgradeTo: "<next tier name>" | null,
 *   }
 */

import type { NextFunction, Response } from "express";
import type { WorkspaceAwareRequest } from "./workspaceResolver";
import {
  entitlementStore,
  getEntitlementLimits,
  type EntitlementLimits,
  type WorkspaceEntitlements,
} from "../billing/entitlements";
import type { SubscriptionTier } from "../billing/subscriptionStore";

// Boolean entitlement features.
type BooleanFeature = "byokAllowed";

// Numeric / quota features.
type QuotaFeature =
  | "runsPerMonth"
  | "agentCap"
  | "integrationCap"
  | "logRetentionDays"
  | "approvalTierMax";

export type EntitlementFeature = BooleanFeature | QuotaFeature;

const BOOLEAN_FEATURES = new Set<EntitlementFeature>(["byokAllowed"]);

// Tier upgrade ladder — drives the "Upgrade to ..." hint in the 402 payload.
const UPGRADE_PATH: Record<SubscriptionTier, SubscriptionTier | null> = {
  explore: "flow",
  flow: "automate",
  automate: "scale",
  scale: null, // Already on the top tier.
};

// Returns the first tier in the upgrade ladder that enables the requested feature,
// skipping tiers where the feature is still gated. This prevents the 402 payload
// from pointing users at a tier that would still block them (e.g. Flow for byokAllowed).
function firstTierThatAllows(
  feature: EntitlementFeature,
  fromTier: SubscriptionTier,
): SubscriptionTier | null {
  // Use ?? null so an unknown/legacy tier value (UPGRADE_PATH returns undefined
  // for non-canonical plan strings) collapses to null and terminates the loop
  // rather than looping forever on `undefined !== null`.
  let tier: SubscriptionTier | null = UPGRADE_PATH[fromTier] ?? null;
  while (tier !== null) {
    const limits = getEntitlementLimits(tier);
    const limit = limits[feature] as boolean | number;
    const allows = BOOLEAN_FEATURES.has(feature) ? limit === true : (limit as number) > 0;
    if (allows) return tier;
    tier = UPGRADE_PATH[tier] ?? null;
  }
  return null;
}

async function entitlementsFor(workspaceId: string): Promise<WorkspaceEntitlements> {
  // DASH-48: get() is now async and falls back to the canonical
  // `entitlements` Postgres row when the in-memory cache misses. Only
  // when both the cache AND the DB have no row do we default to
  // "explore" — pre-DASH-48 this fallback fired on every restart,
  // silently downgrading paid users until the next webhook re-hydrated
  // them.
  const persisted = await entitlementStore.get(workspaceId);
  if (persisted) return persisted;
  return entitlementStore.upsert(workspaceId, "explore");
}

export interface RequireEntitlementOptions {
  /**
   * For quota features only: a function that returns the current count for
   * the workspace. The middleware compares this against the limit.
   *
   * If omitted on a quota feature, the middleware enforces only that the
   * limit > 0 (i.e. the feature is allowed at all under the active plan).
   * That's appropriate for "this action will increment by 1" gates where
   * the count check happens inside the handler.
   */
  getCurrent?: (req: WorkspaceAwareRequest) => Promise<number> | number;

  /**
   * For quota features only: how much the request will add to the count
   * (default 1). Used together with `getCurrent` so the middleware can
   * pre-check `current + delta <= limit`.
   */
  delta?: number;
}

export type RequireEntitlementMiddleware = (
  req: WorkspaceAwareRequest,
  res: Response,
  next: NextFunction,
) => Promise<void> | void;

export function requireEntitlement(
  feature: EntitlementFeature,
  options: RequireEntitlementOptions = {},
): RequireEntitlementMiddleware {
  return async function checkEntitlement(req, res, next) {
    if (!req.workspace) {
      console.error(
        "[requireEntitlement] no req.workspace set. Mount withWorkspace(pool) before requireEntitlement().",
      );
      res.status(500).json({ error: "Server misconfiguration: workspace context missing." });
      return;
    }

    const entitlements = await entitlementsFor(req.workspace.id);
    const limit = entitlements[feature] as boolean | number;

    const denyPayload = {
      error: `Plan limit reached: ${feature}`,
      code: "entitlement_exceeded" as const,
      feature,
      limit,
      currentTier: entitlements.plan,
      upgradeTo: firstTierThatAllows(feature, entitlements.plan),
    };

    if (BOOLEAN_FEATURES.has(feature)) {
      if (limit !== true) {
        res.status(402).json(denyPayload);
        return;
      }
      next();
      return;
    }

    // Quota feature path.
    const quotaLimit = limit as number;
    const delta = Math.max(0, options.delta ?? 1);

    if (quotaLimit <= 0) {
      // Plan doesn't allow the feature at all (e.g. agentCap=0 on a tier
      // that excludes agents).
      res.status(402).json(denyPayload);
      return;
    }

    if (!options.getCurrent) {
      // No count provided — middleware just confirms the feature is
      // available under the plan. Per-request count enforcement happens
      // inside the handler.
      next();
      return;
    }

    let current: number;
    try {
      current = await options.getCurrent(req);
    } catch (err) {
      console.error(
        `[requireEntitlement] getCurrent threw for feature=${feature}:`,
        (err as Error).message,
      );
      res.status(500).json({ error: "Failed to evaluate entitlement quota." });
      return;
    }

    if (current + delta > quotaLimit) {
      res.status(402).json({ ...denyPayload, current });
      return;
    }

    next();
  };
}

// Re-exports so consumers don't need to import from billing/entitlements directly
// (keeps the middleware module self-contained at the API boundary).
export type { EntitlementLimits, WorkspaceEntitlements };
