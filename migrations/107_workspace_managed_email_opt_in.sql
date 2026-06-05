-- HEL-615 — managed Layer-C customer-facing email opt-in.
--
-- Per-workspace override for whether kind:'customer' email is sent through the
-- managed SES Layer-C pool (via.helloautoflow.com, dedicated IP pools). NULL =
-- use the plan default: SMB plans (explore/flow) opt IN, SME plans
-- (automate/scale) opt OUT — see customerEmailPolicy.ts /
-- defaultManagedEmailOptIn (plan decision #2).
--
-- Read directly via getPostgresPool() (mirrors the workspaces.tier_routing /
-- owner_user_id system reads in tierRouter.ts / failureDigest.ts); the
-- workspaces table is RLS-enabled-not-forced, so the app role reads it.

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS managed_email_opt_in boolean;
