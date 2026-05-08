# AutoFlow — Canonical Noun Glossary

This file is the authoritative source for domain noun names in AutoFlow. All
code, docs, and database tables must use these names on customer-facing and
internal surfaces. The rename from the legacy `control_plane_*` / `provisioned_*`
prefixes was executed in migration 021 (HEL-43).

## Core entities

| Canonical name        | Old (pre-021) name                   | Description |
|-----------------------|--------------------------------------|-------------|
| `companies`           | `provisioned_companies`              | Tenant company records provisioned inside a workspace |
| `agents`              | `control_plane_agents`               | AI agent definitions within a team |
| `agent_teams`         | `control_plane_teams`                | Named teams of agents that execute a workflow |
| `agent_executions`    | `control_plane_executions`           | A single agent execution run |
| `agent_tasks`         | `control_plane_tasks`                | Human-in-the-loop tasks created during an execution |
| `agent_heartbeats`    | `control_plane_heartbeats`           | Agent heartbeat records within an execution |
| `spend_entries`       | `control_plane_spend_entries`        | Per-token or per-tool spend entries for billing |
| `budget_alerts`       | `control_plane_budget_alerts`        | Budget threshold alerts for teams and agents |
| `audit_log`           | `control_plane_audit_log` + `control_plane_secret_audit` | Unified append-only audit ledger |
| `company_lifecycle`   | `control_plane_company_lifecycle`    | Pause/resume state for a provisioned company |
| `company_lifecycle_audit` | `control_plane_company_lifecycle_audit` | Audit trail for lifecycle actions |
| `llm_credentials`     | `llm_configs`                        | LLM provider credentials (API keys, models) |

## Rule

> Do not use `control_plane_*`, `provisioned_*`, or `llm_configs` in any
> customer-facing surface (`dashboard/`, `landing/`, `docs/`). The CI grep
> guard in `.github/workflows/ci.yml` enforces this.
>
> The `src/controlPlane/` module directory is intentionally preserved — it is
> an internal implementation namespace, not a customer-facing noun.

## Tables intentionally not renamed

| Table | Reason |
|-------|--------|
| `provisioned_company_secrets` | Still valid name; FK to `companies` auto-updated |
| `agent_heartbeat_logs` | Legacy; `agentMemoryStore.ts` manages its own DDL inline |
| `memory_entries` | Legacy; referenced by `runtimeRetention.ts` |
| `observability_events` | Live queries in `observability/store.ts` |
