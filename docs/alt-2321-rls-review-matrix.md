# ALT-2321 Phase 1b RLS Review Matrix

Generated on 2026-05-05 for `feat/ALT-2321-supabase-schema-plan`.

## Purpose

Phase 1b is the highest-risk slice of ALT-2321 because Supabase will expose Postgres through JWT-scoped client sessions rather than only backend-controlled connections. This matrix turns the Phase 1a inventory into an explicit table-by-table access decision before Brad reviews any production-facing policy set.

Companion draft SQL:

- `supabase/migrations/20260505054500_alt_2321_phase1b_rls_draft.sql`

## Policy Families

### Workspace-scoped

Use the existing pattern already present on `tickets`, `campaigns`, and `workspace_members`:

```sql
public.app_current_workspace_id() IS NOT NULL
AND workspace_id = public.app_current_workspace_id()
```

Applies when the row belongs to exactly one workspace and clients should only see the currently selected workspace.

### User-scoped

Use direct ownership keyed on `public.app_current_user_id()`:

```sql
public.app_current_user_id() IS NOT NULL
AND user_id = public.app_current_user_id()
```

Applies when the row is per-user configuration or history.

### Parent-inherited

Use `EXISTS (...)` against a parent table that is already scoped by user or workspace. This avoids duplicating tenant columns on child tables that only exist to decorate a parent record.

### Service-role-only

Enable RLS but define no permissive client policies. In Supabase that denies access to `anon`/`authenticated` while still allowing service-role and migration execution paths.

## Review Matrix

| Table | Key columns | Recommended access model | Draft status | Notes |
|---|---|---|---|---|
| `approval_tier_policies` | `workspace_id` | Workspace-scoped | Included | Same pattern as `ticket_sla_policies` |
| `notification_channel_configs` | `workspace_id`, `owner_user_id` | Workspace-scoped | Included | Owner is metadata; workspace should govern visibility |
| `notification_deliveries` | `workspace_id`, `event_id` | Workspace-scoped | Included | Delivery records follow the workspace event stream |
| `notification_events` | `workspace_id` | Workspace-scoped | Included | Direct tenant event feed |
| `notification_preferences` | `workspace_id` | Workspace-scoped | Included | Current schema is workspace-level, not per-user |
| `user_profiles` | `user_id` | User-scoped | Included | One profile per current user |
| `llm_configs` | `user_id` | User-scoped | Included | Secrets/config must stay private per user |
| `connector_credentials` | `user_id` | User-scoped | Included | Sensitive integration credentials |
| `generated_reports` | `user_id`, `team_id` | User-scoped | Included | Team sharing can be a later expansion |
| `memory_entries` | `user_id` | User-scoped | Included | Legacy memory storage |
| `workflow_runs` | `user_id` | User-scoped | Included | Nullable `user_id` means backend/system runs remain hidden from clients |
| `ticket_assignments` | `ticket_id` | Parent-inherited from `tickets` | Included | Workspace access follows parent ticket |
| `ticket_notifications` | `ticket_id` | Parent-inherited from `tickets` | Included | Same as above |
| `ticket_updates` | `ticket_id` | Parent-inherited from `tickets` | Included | Same as above |
| `workflow_queue_jobs` | `run_id` | Parent-inherited from `workflow_runs` | Included | Client sees only jobs for owned runs |
| `workflow_step_results` | `run_id` | Parent-inherited from `workflow_runs` | Included | Client sees only step results for owned runs |
| `approval_requests` | `user_id`, `assignee` | Hybrid user/assignee model | Included | Draft exposes records to requestor and current assignee text id |
| `approval_notifications` | `approval_request_id`, `recipient` | Parent-inherited from `approval_requests` | Included | Follows approval request access; recipient match retained |
| `agent_heartbeat_logs` | `workspace_id`, `user_id`, `agent_id` | Service-role-only | Included | Heartbeat audit is backend/internal |
| `agent_memory_entries` | `workspace_id`, `user_id`, `agent_id` | Service-role-only | Included | MemPalace backing store should stay backend-only |
| `agent_memory_events` | `workspace_id`, `user_id`, `agent_id` | Service-role-only | Included | Same rationale |
| `agent_memory_kg_facts` | `workspace_id`, `user_id`, `agent_id` | Service-role-only | Included | Same rationale |
| `control_plane_company_lifecycle` | `user_id` | Service-role-only | Included | Kill-switch lifecycle state is operator-only |
| `control_plane_company_lifecycle_audit` | `user_id`, `run_id` | Service-role-only | Included | Audit trail must remain privileged |
| `social_auth_users` | `email`, `provider_user_id` | Service-role-only | Included | Auth bridge table should not be client-queryable |

## Open Decisions Brad Should Review

1. `approval_requests`
   - Draft assumption: the requestor (`user_id`) and the current assignee text id (`assignee`) should both be able to view the record.
   - Risk: `assignee` is not normalized by actor type in this schema, so mixed user/agent identities may need a stricter typed model later.

2. `notification_preferences`
   - Current table is workspace-level only.
   - If notifications become user-specific later, the schema likely needs `user_id` or membership-role targeting before policy granularity can improve.

3. `workflow_runs`
   - Rows with `user_id IS NULL` are treated as backend/system-owned and denied to clients.
   - If some shared/system workflows must be visible in the product, they need an explicit workspace ownership column instead of relying on nullable user ownership.

4. `generated_reports`
   - Draft keeps access user-private even when `team_id` is present.
   - If team reports should be visible to team members, we need a team-membership policy source of truth first.

## 2026-05-05 Validation Notes

Applied `supabase/migrations/20260505054500_alt_2321_phase1b_rls_draft.sql` to Supabase project `undvoetvdjkhiyqhtypt` after the Phase 1a bootstrap schema load.

Validated under `SET LOCAL ROLE authenticated` with rollback-only fixture data:

- User-scoped family:
  - `user_profiles` returned 1 row when `request.jwt.claims.sub = 'phase1-user'`
- Parent-inherited family:
  - `ticket_updates` returned 1 row when the parent ticket belonged to the injected `workspaceId`
- Service-role-only family:
  - `agent_heartbeat_logs` returned 0 rows even when claims were present

This does not finish Brad's review. It only proves that the draft policy families behave as intended for representative tables.

## Intentional Non-Goals In This Draft

- No `auth.users` foreign-key conversion yet.
- No attempt to expose observability partitions or control-plane tables to client roles.
- No grants/role DDL; the draft only handles RLS posture inside `public`.

## Recommended Next Step

Apply the draft migration to an empty Supabase project, inspect the resulting policy set, and then review the four open decisions above before any production promotion.
