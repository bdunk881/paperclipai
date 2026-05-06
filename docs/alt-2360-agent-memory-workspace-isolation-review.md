# ALT-2360 Review Packet

## Summary

`migrations/016_agent_memory_workspace_isolation.sql` tightens the agent-memory schema in two ways:

1. It makes the committed migrations match the runtime bootstrap by restoring the missing `scope` columns and preserving `entry_type`.
2. It introduces an explicit cross-workspace sharing model that defaults to deny and requires both an enabled policy and an active allowlist grant.

## What Changes

- Workspace isolation remains the default read boundary for `agent_memory_entries`, `agent_memory_kg_facts`, `agent_heartbeat_logs`, and `agent_memory_events`.
- Team isolation is now enforced at the schema layer: `memory_layer = 'team'` requires `team_id IS NOT NULL`.
- New table `agent_memory_sharing_policies` records whether a source workspace has opted into cross-workspace sharing for a given layer.
- New table `agent_memory_workspace_shares` records the explicit target-workspace allowlist entries.

## Default Posture

Cross-workspace recall is denied unless all of the following are true:

- The source row still passes its normal workspace and layer checks.
- A matching `agent_memory_sharing_policies` row exists with `cross_workspace_enabled = true`.
- A matching `agent_memory_workspace_shares` row exists for the source workspace, target workspace, and memory layer.
- The share row has not been revoked.
- The entity kind is permitted by both the policy row and the grant row.
- If the policy requires `scope = 'shared'`, the underlying memory row is explicitly shared.

## Future RLS Decision Path

Future RLS or service-role read paths should evaluate visibility in this order:

1. `workspace_id`
2. `memory_layer`
3. `team_id` when the row is team-scoped
4. row `scope`
5. sharing policy opt-in
6. active source-to-target workspace grant

That allows service-role jobs to read across workspaces only when the user has created both the opt-in policy and the explicit grant. Service-role access stays possible, but it stops being an implicit bypass of tenant intent.
