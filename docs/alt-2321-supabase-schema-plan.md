# ALT-2321 Supabase Schema Plan

Generated on 2026-05-05 from `schema.sql` on `origin/migration` commit `5302a5b`.

## Scope

Phase 1a asks for a first-pass Supabase bootstrap from the committed Postgres dump, plus a concrete review of what still needs Supabase-specific handling before the schema is safe to apply and expose.

This heartbeat produced:

- `supabase/migrations/20260505043000_alt_2321_initial_schema.sql`
- `supabase/migrations/20260505054500_alt_2321_phase1b_rls_draft.sql`
- `docs/alt-2321-rls-review-matrix.md`
- this review document

## Source Inventory

- Schemas in dump: `public`, `observability`
- Tables: 66
- Extensions required by dump: `pgcrypto`
- User-defined SQL/plpgsql functions in dump include:
  - `public.app_current_user_id()`
  - `public.app_current_workspace_id()`
  - `public.enforce_email_send_workspace_match()`
  - `observability.ensure_event_partitions(...)`
  - `observability.refresh_rollups(...)`
  - `observability.apply_retention(...)`
- Trigger objects: 1
- Existing RLS-enabled tables: 20
- Existing FORCE RLS tables: 11
- Enum types: none
- Serial / bigserial primary keys: none found in the dump

## Supabase-Specific Handling

### 1. Session helpers must read JWT claims

The dump's existing policies rely on:

- `public.app_current_user_id()`
- `public.app_current_workspace_id()`

The original dump implementations only read legacy session settings:

- `app.current_user_id`
- `app.current_workspace_id`

That is not enough for Supabase. The generated draft rewrites both helpers to:

- preserve the legacy session-setting fallback for server-side jobs and existing app code
- read Supabase JWT claims for `sub`
- read workspace claims from the same keys the current auth middleware already accepts:
  - `workspaceId`
  - `workspace_id`
  - `extension_workspaceId`
  - `extension_workspace_id`
  - `https://autoflow.ai/workspaceId`
  - `https://autoflow.ai/workspace_id`

This keeps the current RLS predicates usable without rewriting every policy in the first draft.

### 2. Ownership statements must be removed

`schema.sql` contains `ALTER ... OWNER TO paperclip` statements throughout. Those do not map cleanly onto Supabase roles, so the generated draft strips them.

### 3. Observability maintenance stays privileged

These functions still assume a privileged migration or service-role path:

- `observability.ensure_event_partitions(...)`
- `observability.apply_retention(...)`

They create or drop partitions dynamically and should not be callable by normal client roles.

### 4. `auth.users` foreign keys are not present yet

There are no direct `REFERENCES auth.users(id)` constraints in the dump.

Current identity columns are mostly modeled as `text`, for example:

- `user_profiles.user_id`
- `workspace_members.user_id`
- `workspaces.owner_user_id`
- `connector_credentials.user_id`
- `workflow_runs.user_id`
- `llm_configs.user_id`

That means the lowest-risk Phase 1 draft is:

- keep the current text-based identity columns
- let Supabase JWT `sub` drive RLS/user scoping
- defer any hard FK bridge to `auth.users(id)` until the auth migration decides whether user identifiers stay text or become UUID-typed columns

## UUID vs. Serial Review

The dump is already aligned with Supabase on identifiers:

- UUID primary keys dominate the schema
- natural text keys remain for template/import metadata
- no serial or bigserial PK rewrite is required in Phase 1a

The main identity mismatch is not PK generation. It is the lack of a committed `auth.users` relationship strategy for existing `text` user identifiers.

## Existing RLS Preserved In The Draft

The generated migration preserves existing RLS enables/policies for:

- `campaigns`
- `control_plane_agents`
- `control_plane_audit_log`
- `control_plane_budget_alerts`
- `control_plane_executions`
- `control_plane_heartbeats`
- `control_plane_secret_audit`
- `control_plane_spend_entries`
- `control_plane_tasks`
- `control_plane_teams`
- `email_sends`
- `icp_profiles`
- `leads`
- `provisioned_companies`
- `provisioned_company_secrets`
- `ticket_sla_policies`
- `ticket_sla_snapshots`
- `tickets`
- `workspace_members`
- `workspaces`

The existing pattern is mostly workspace isolation:

```sql
app_current_workspace_id() IS NOT NULL
AND workspace_id = app_current_workspace_id()
```

`workspaces` also checks ownership or membership through `app_current_user_id()`.

## Tables That Still Need Phase 1b RLS Design

Not every table below should become directly queryable from client-side Supabase access, but each needs an explicit decision instead of relying on default role grants.

### Workspace-scoped tables with no RLS yet

- `approval_tier_policies`
- `notification_channel_configs`
- `notification_deliveries`
- `notification_events`
- `notification_preferences`

These are the clearest candidates for direct tenant-isolation policies.

### User-scoped tables with no RLS yet

- `agent_heartbeat_logs`
- `agent_memory_entries`
- `agent_memory_events`
- `agent_memory_kg_facts`
- `approval_requests`
- `connector_credentials`
- `control_plane_company_lifecycle`
- `control_plane_company_lifecycle_audit`
- `generated_reports`
- `llm_configs`
- `memory_entries`
- `observability_events`
- `user_profiles`
- `workflow_runs`

These need either:

- user-owned policies keyed off `app_current_user_id()`, or
- service-role-only access if they remain backend-managed tables

### Relationship-scoped tables that should inherit access from a parent record

- `approval_notifications`
- `ticket_assignments`
- `ticket_notifications`
- `ticket_updates`
- `workflow_queue_jobs`
- `workflow_step_results`

These likely need join-backed policies through `approval_requests`, `tickets`, or `workflow_runs` instead of standalone predicates.

### Service-role-only / internal-only candidates

- `observability.events` and rollup tables
- the date-partition child tables under `observability`
- `social_auth_users`

These should probably not be exposed to client roles at all in the first Supabase rollout.

## Initial Migration Draft Strategy

The generated draft at `supabase/migrations/20260505043000_alt_2321_initial_schema.sql` is intentionally a bootstrap artifact, not the final reviewed rollout SQL.

It does the following:

- starts from the committed dump rather than replaying 20 historical migrations
- strips pg_dump session wrappers and explicit ownership changes
- preserves tables, constraints, indexes, triggers, functions, RLS enables, FORCE RLS directives, and existing policies
- swaps in Supabase-aware versions of the two RLS helper functions

It intentionally does not yet:

- add `auth.users` foreign keys
- redesign the full missing-policy set above
- separate privileged observability maintenance from user-facing access paths

## 2026-05-05 Supabase Apply Validation

Applied the generated bootstrap draft to the provisioned Supabase project:

- Project ref: `undvoetvdjkhiyqhtypt`
- Region: `us-east-1`
- Apply path: Supabase Management API `POST /v1/projects/{ref}/database/query`

Observed post-apply object counts:

- `public` tables: 47
- `observability` tables: 19
- `public` policies: 24
- `email_sends` trigger count: 1
- `observability` maintenance functions present:
  - `apply_retention`
  - `ensure_event_partitions`
  - `refresh_rollups`

RLS validation completed:

- With `SET LOCAL ROLE authenticated` and no injected JWT claims:
  - `app_current_user_id()` returned `NULL`
  - `app_current_workspace_id()` returned `NULL`
  - `SELECT count(*) FROM public.workspaces` returned `0`
- With rollback-only fixture data plus injected `request.jwt.claims`:
  - `app_current_user_id()` resolved the synthetic `sub`
  - `app_current_workspace_id()` resolved the synthetic `workspaceId`
  - `workspaces` policy admitted the expected row
  - `workspace_members` policy admitted the expected row
  - `campaigns` tenant-isolation policy admitted the expected row

Validation limits still outstanding:

- The schema apply ran through the Management API as `postgres`, so DDL privilege compatibility for lower-privilege direct DB roles is not yet proven.
- Historical `migrations/` replay was not run against this same project after the bootstrap apply, because the bootstrap already materialized the target schema and replaying the existing migrations here would only test duplicate-object behavior.
- The highest-risk remaining work is still Phase 1b: explicit review and design for the tables listed above that do not yet have vetted Supabase-era RLS coverage.

## Recommended Next Steps

1. Review `docs/alt-2321-rls-review-matrix.md` and `supabase/migrations/20260505054500_alt_2321_phase1b_rls_draft.sql` with Brad before promoting any new policy set.
2. Review the generated bootstrap SQL against Supabase project conventions, especially extension schema placement and privileged function execution.
3. Decide whether user identity remains `text` or gets normalized toward `auth.users.id` in a follow-up migration.
4. Validate both draft migrations on an empty Supabase project before wiring them into any automated rollout path.
