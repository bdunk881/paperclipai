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

This keeps the current RLS predicates usable without rewriting every policy in the first draft.

The earlier draft also mentioned two `https://autoflow.ai/...` namespaced claim keys. Those were speculative and used the wrong domain. They have been removed from both the runtime middleware and the generated Supabase helper. If we standardize on a namespaced custom claim later, it should be added back only with the real issuer-controlled namespace.

### 2. Ownership statements must be removed

`schema.sql` contains `ALTER ... OWNER TO paperclip` statements throughout. Those do not map cleanly onto Supabase roles, so the generated draft strips them.

More concretely:

- In PostgreSQL, the owner of a table/function/schema is the principal that can `ALTER`, `DROP`, `GRANT`, and otherwise administer that object.
- Ownership also affects operational behavior such as who can redefine functions and whether a table owner can bypass RLS unless `FORCE ROW LEVEL SECURITY` is enabled.
- The dump was taken from an environment where the owning role was literally `paperclip`.
- In Supabase, that role does not exist. Replaying `ALTER ... OWNER TO paperclip` would either fail outright or create a misleading ownership model that does not match Supabase's managed roles.

So the bootstrap draft keeps the schema objects, policies, triggers, and functions, but lets ownership fall to the role executing the migration in Supabase. That is the only portable baseline. Any deliberate ownership or `SECURITY DEFINER` strategy has to be reintroduced intentionally against the actual Supabase role model, not copied from the source dump blindly.

### 3. Observability maintenance stays privileged

These functions still assume a privileged migration or service-role path:

- `observability.ensure_event_partitions(...)`
- `observability.apply_retention(...)`

They create or drop partitions dynamically and should not be callable by normal client roles.

### 4. A real auth identity bridge is not present yet

There are no direct `REFERENCES auth.users(id)` constraints in the dump, but the deeper issue is broader than Supabase's `auth.users`.

The current product does not treat Supabase Auth as the source of truth. Auth is already brokered externally through systems like Azure External ID and social OAuth. The schema reflects that history:

- `user_profiles` is just a local profile row keyed by `user_id text`
- `workspace_members.user_id` and `workspaces.owner_user_id` are also local text identifiers
- `social_auth_users` is not a link table; it currently creates the local user row keyed by provider identity rather than linking an external identity to an existing local account

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
- defer any hard FK bridge until the auth migration defines a provider-agnostic identity-link table

## UUID vs. Serial Review

The dump is already aligned with Supabase on identifiers:

- UUID primary keys dominate the schema
- natural text keys remain for template/import metadata
- no serial or bigserial PK rewrite is required in Phase 1a

The main identity mismatch is not PK generation. It is the lack of a committed external-identity-to-local-user relationship strategy for existing `text` user identifiers.

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

The four agent-memory tables need a separate note because they are not actually good candidates for simple per-user isolation:

- `agent_heartbeat_logs`
- `agent_memory_entries`
- `agent_memory_events`
- `agent_memory_kg_facts`

Those tables back agent collaboration and cross-agent memory recall. They already carry `workspace_id`, `agent_id`, `memory_layer`, and in some cases `scope`. The key design point is:

- they should not be exposed to arbitrary client sessions
- but they also should not be modeled as "current human user can only see their own rows"
- cross-agent reads inside the same workspace must remain possible for backend agents and orchestrators

So "service-role-only" in the current matrix should be read as an operational posture for Phase 1 client exposure, not as a claim that the underlying data model is per-user. If these tables ever get non-service-role RLS policies, they should be workspace-scoped and memory-layer-aware, not simply `user_id = app_current_user_id()`.

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

## 2026-05-05 Design Follow-Up

User feedback on the review packet changed several design conclusions:

1. Workspace claim namespace
   - The hardcoded `https://autoflow.ai/...` claim keys were wrong and have been removed.
   - Phase 1 should rely on the un-namespaced keys already accepted in runtime auth (`workspaceId`, `workspace_id`, `extension_workspaceId`, `extension_workspace_id`) plus the legacy session variables.

2. Ownership stripping
   - This is not cosmetic. It is required because the source dump's owner role (`paperclip`) does not exist in Supabase.
   - Reintroducing deliberate ownership later is allowed, but only after we choose the actual Supabase execution roles and decide whether any functions should be `SECURITY DEFINER`.

3. Accepted follow-up schema additions
   - `notification_preferences` should remain the workspace-default table because the current schema only keys by `workspace_id`, `channel`, and `kind`.
   - Per-user notification settings should be added as a separate override table rather than changing the meaning of the existing workspace-default rows.
   - External login linking should move to a provider-agnostic identity bridge plus an explicit merge-request audit trail.
   - Agent memory must isolate by workspace and team unless a user explicitly enables cross-workspace recall.

### Follow-up schema sketches accepted in review

These are not part of the already-merged Phase 1 bootstrap SQL. They are the accepted direction for the next schema pass.

#### User-level notification overrides

Keep `notification_preferences` as workspace defaults, then add a per-user override layer:

```sql
user_notification_preferences(
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id text not null,
  channel text not null,
  kind text not null,
  cadence text not null,
  muted_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, channel, kind)
)
```

This preserves the current workspace-level behavior while allowing user-specific opt-out or cadence changes.

#### Provider-agnostic auth linking

The current `social_auth_users` table is not enough for "existing local account, prompt to merge, link on consent" behavior. The follow-up schema should introduce:

```sql
user_auth_identities(
  id uuid primary key,
  local_user_id text not null,
  provider text not null,
  provider_subject text not null,
  email text,
  email_verified_at timestamptz,
  linked_at timestamptz not null default now(),
  last_login_at timestamptz,
  unique (provider, provider_subject)
)
```

```sql
user_auth_merge_requests(
  id uuid primary key,
  local_user_id text not null,
  provider text not null,
  provider_subject text not null,
  provider_email text,
  requested_by_user_id text,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text not null,
  resolved_by_user_id text,
  audit_note text
)
```

That split keeps the long-lived identity link separate from the merge/consent audit record.

#### Cross-workspace memory must be explicit

The four agent-memory tables are backend-shared infrastructure, but they still need strict tenancy boundaries:

- isolate by `workspace_id` by default
- further isolate by `team_id` where present
- never allow ambient cross-workspace reads
- only allow cross-workspace recall through an explicit user-controlled sharing record

One acceptable follow-up shape would be:

```sql
agent_memory_sharing_preferences(
  id uuid primary key,
  owner_user_id text not null,
  source_workspace_id uuid not null references workspaces(id) on delete cascade,
  target_workspace_id uuid not null references workspaces(id) on delete cascade,
  scope text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, source_workspace_id, target_workspace_id, scope)
)
```

If agent-memory RLS ever moves beyond service-role-only access, it should consult:

- `workspace_id`
- `team_id`
- `memory_layer`
- `scope`
- an explicit sharing preference such as the table above

3. External auth identity mapping
   - The real missing piece is not "a foreign key to `auth.users`".
   - The real missing piece is a provider-agnostic identity-link table that maps external identities to existing local users and supports explicit merge consent.
   - A follow-up schema should look more like:
     - `user_auth_identities(local_user_id, provider, provider_subject, email, email_verified_at, linked_at, last_login_at)`
     - optionally `user_auth_merge_requests(...)` if we want a durable approval/audit trail around account-link prompts

4. Social auth merge behavior
   - The current `social_auth_users` table is insufficient for merge approval because it conflates the local account row with the external identity row.
   - It can upsert "the user for this provider subject", but it cannot represent "this external login matches an existing local account and needs explicit user consent before linking."

5. Notification preferences
   - `notification_preferences` is workspace-scoped today because the actual schema only has `workspace_id`, and the uniqueness rule is `UNIQUE (workspace_id, channel, kind)`.
   - There is no `user_id`, `recipient_id`, or membership target on the table today, so calling it per-user would be factually wrong.

6. `user_profiles`
   - `user_profiles` is still correctly modeled as per-local-user profile data.
   - What needs to change is not the profile row itself, but the identity-link layer sitting beside it so multiple external providers can resolve to the same local user after an explicit merge flow.

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

## 2026-05-05 Phase 1d Validation

Validation was run from `origin/migration` at merge commit `4d82c5f` after the Upstash queue change landed.

Node / TypeScript validation:

- `npm run build` completed successfully.
- Jest required an override because the repo config ignores `/.worktrees/` paths by default. Running
  `npx jest --config jest.config.cjs --runInBand --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='/dashboard/'`
  produced:
  - test suites: `101 passed`, `1 skipped`
  - tests: `1253 passed`, `30 skipped`, `1 todo`
- `src/engine/queue.test.ts` passed with the Upstash-backed queue mode enabled in tests.
- Jest still force-exits because background coordinators keep logging after teardown:
  - `src/engine/approvalResumeCoordinator.ts`
  - `src/engine/ticketSlaCoordinator.ts`
  This is a pre-existing test-harness issue, not a queue regression.

Python / FastAPI validation:

- `python3 -m pytest backend/tests -q` passed: `134 passed` in `0.38s`.
- The FastAPI backend in `backend/main.py` remains an in-memory knowledge service and does not currently bind to Supabase Postgres or Upstash Redis, so its validation surface is limited to route and contract coverage rather than live infrastructure wiring.

Runtime and infrastructure probes:

- Local Postgres smoke check passed with the current shell `DATABASE_URL`:
  - `psql "$DATABASE_URL" -c 'select 1 as ok'`
- Live Supabase control-plane query succeeded against project `undvoetvdjkhiyqhtypt`:
  - `select current_database() as db, current_user as role, now() as ts`
  - returned `postgres / postgres`
- Live Upstash REST probe succeeded:
  - `RPUSH`, `LLEN`, and `LPOP` on a temporary queue key preserved FIFO order for `phase1d-a` then `phase1d-b`

Remaining limitation:

- This heartbeat did not include a direct Supabase Postgres connection string, so the Node API could not be started against `DATABASE_URL=<Supabase DSN>` in-process.
- `npm run dev` is also not runnable in this environment because `ts-node` is not installed in the current toolchain, although the compiled build path succeeded.

## Recommended Next Steps

1. Review `docs/alt-2321-rls-review-matrix.md` and `supabase/migrations/20260505054500_alt_2321_phase1b_rls_draft.sql` with Brad before promoting any new policy set.
2. Review the generated bootstrap SQL against Supabase project conventions, especially extension schema placement and privileged function execution.
3. Provide a direct Supabase Postgres DSN for a true app-level `DATABASE_URL` smoke test if Phase 1d requires runtime proof beyond the control-plane query path above.
4. Decide whether user identity remains `text` or gets normalized toward `auth.users.id` in a follow-up migration.
5. Validate both draft migrations on an empty Supabase project before wiring them into any automated rollout path.
