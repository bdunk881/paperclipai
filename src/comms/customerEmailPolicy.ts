/**
 * Managed Layer-C customer-email policy (HEL-615).
 *
 * Decides whether a `kind:'customer'` email goes through the managed SES pool,
 * and with which per-tier configuration set. Combines three inputs:
 *   - **Suppression** (HEL-360): never email a suppressed recipient.
 *   - **Opt-in** (plan decision #2): SMB plans opt IN, SME plans opt OUT, with a
 *     per-workspace override (`workspaces.managed_email_opt_in`).
 *   - **Tier → SES configuration set**: SES v2 binds a dedicated IP pool to a
 *     configuration set, so the reputation segment selects the config set
 *     (reputation isolation from Layer A/B + per-tier pools).
 *
 * Opt-out is ledgered `suppressed` (reason `managed_email_opt_out`) in v1;
 * routing opted-out tenants to their own BYOC SendGrid is HEL-716.
 */

import {
  getPostgresPool,
  inMemoryAllowed,
  isPostgresPersistenceEnabled,
} from "../db/postgres";
import {
  customerSegmentForPlan,
  defaultManagedEmailOptIn,
  entitlementStore,
} from "../billing/entitlements";
import type { SubscriptionTier } from "../billing/subscriptionStore";
import { suppressionStore } from "../mailer/suppressionStore";

export type CustomerSegment = "smb" | "sme";

function normalizeEnv(name: string): string | undefined {
  const raw = process.env[name];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * SES configuration set for a reputation segment. Env-driven — ops binds each
 * config set to its dedicated IP pool (see the runbook). Undefined when
 * unconfigured: the SES SendEmail then uses the account default (acceptable in
 * dev / pre-provisioning; the runbook is the go-live gate).
 */
export function configurationSetForSegment(segment: CustomerSegment): string | undefined {
  return segment === "sme"
    ? normalizeEnv("SES_CONFIGURATION_SET_SME")
    : normalizeEnv("SES_CONFIGURATION_SET_SMB");
}

export type ManagedEmailDecision =
  | { action: "send"; segment: CustomerSegment; configurationSet: string | undefined }
  | { action: "suppressed"; reason: string };

export interface ManagedEmailPolicyDeps {
  /** Suppression check (test injection). Defaults to the suppression store. */
  isSuppressed?: (workspaceId: string, email: string) => Promise<boolean>;
  /** Resolve the workspace's billing plan (test injection). */
  getPlan?: (workspaceId: string) => Promise<SubscriptionTier | undefined>;
  /** Per-workspace opt-in override; NULL ⇒ use the plan default (test injection). */
  getOptInOverride?: (workspaceId: string) => Promise<boolean | null>;
}

async function defaultGetPlan(workspaceId: string): Promise<SubscriptionTier | undefined> {
  const entitlements = await entitlementStore.get(workspaceId);
  return entitlements?.plan;
}

async function defaultGetOptInOverride(workspaceId: string): Promise<boolean | null> {
  if (!isPostgresPersistenceEnabled()) {
    if (inMemoryAllowed()) return null;
    throw new Error("managed email policy requires DATABASE_URL outside development/test.");
  }
  // Direct read — mirrors workspaces.tier_routing (tierRouter.ts) / owner_user_id
  // (failureDigest.ts); workspaces is RLS-enabled-not-forced.
  const result = await getPostgresPool().query<{ managed_email_opt_in: boolean | null }>(
    `SELECT managed_email_opt_in FROM workspaces WHERE id = $1`,
    [workspaceId],
  );
  return result.rows[0]?.managed_email_opt_in ?? null;
}

/**
 * Evaluate the managed-email decision for a customer email. A suppressed
 * recipient or an opted-out workspace ⇒ `{suppressed}`; otherwise `{send}`
 * with the per-segment configuration set.
 */
export async function evaluateManagedEmail(
  workspaceId: string,
  to: string,
  deps: ManagedEmailPolicyDeps = {},
): Promise<ManagedEmailDecision> {
  const isSuppressed =
    deps.isSuppressed ?? ((ws, email) => suppressionStore.isSuppressed(ws, email));
  if (await isSuppressed(workspaceId, to)) {
    return { action: "suppressed", reason: "suppressed" };
  }

  const plan = (await (deps.getPlan ?? defaultGetPlan)(workspaceId)) ?? "explore";
  const override = await (deps.getOptInOverride ?? defaultGetOptInOverride)(workspaceId);
  const optIn = override ?? defaultManagedEmailOptIn(plan);
  if (!optIn) {
    return { action: "suppressed", reason: "managed_email_opt_out" };
  }

  const segment = customerSegmentForPlan(plan);
  return { action: "send", segment, configurationSet: configurationSetForSegment(segment) };
}
