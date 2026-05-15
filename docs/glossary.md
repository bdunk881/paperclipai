# AutoFlow — Canonical Noun Glossary

This file is the authoritative source for domain noun names in AutoFlow. All
code, docs, and database tables must use these names on customer-facing and
internal surfaces. The original rename from the legacy `control_plane_*` /
`provisioned_*` prefixes was executed in migration `021_canonical_noun_rename`
(HEL-43); the canonical schema was completed in migrations 022–035.

## Core entities (canonical → table)

| Canonical noun | Table | Migration | Description |
|---|---|---|---|
| Workspace | `workspaces` | 001 | Tenancy boundary. Every customer-facing row is scoped here. |
| Workspace member | `workspace_members` | 026 | User ↔ workspace edge with role (`owner`, `admin`, `billing`, `operator`, `developer`, `approver`). |
| Company | `companies` | 022 | A workspace's representation of the business it runs. |
| Mission | `missions` | 022 (metadata in 032) | Free-text statement of what the company is trying to do; drives team generation. |
| Hiring plan | `hiring_plans` | 022 | LLM-generated draft team structure awaiting human approval. |
| Agent | `agents` | 015 / 021 | Persistent named worker (role, model tier, tools, budget). |
| Agent assignment | `agent_assignments` | 031 | Agent ↔ mission/team mapping. |
| Org edge | `org_edges` | 031 | Manager → report graph between agents. |
| Agent team | `agent_teams` | 015 / 021 | Named group of agents executing one workflow. |
| Routine | `routines` | 023 | Scheduled or triggered run definition for a workflow. |
| Workflow | `workflows` | 023 | DAG of steps that a routine runs. Owns one or many versions. |
| Workflow version | `workflow_versions` | 023 | Immutable versioned snapshot of a workflow (replays + audit). |
| Run | `runs` | 023 | One execution of a specific workflow version on specific input. |
| Step result | `step_results` | 023 | Output / cost / duration / error for one node within a run. |
| Approval | `approvals` | 024 | Human-in-the-loop gate inside a run. Tier-policied. |
| Activity event | `activity_events` | 024 | Workspace-scoped append-only feed of everything happening. |
| Ticket | `agent_tasks` | 008 / 021 | Long-lived assignable unit of work (broader than approval). |
| Connector connection | `connector_connections` | 025 | Workspace-bound credential for an integration. |
| LLM credential | `llm_credentials` | 025 (originally 005 as `llm_configs`) | Workspace-bound provider API key (BYOK). |
| Budget | `budgets` | 025 | Spend cap per agent or per workspace; enforced before LLM/tool calls. |
| Subscription | `subscriptions` | 025 + 028 | Stripe subscription bound to a workspace. |
| Entitlement | `entitlements` | 025 | Resolved per-workspace plan limits driving `requireEntitlement()`. |
| Stripe webhook event | `stripe_webhook_events` | 029 | Idempotency ledger for Stripe webhook deliveries. |
| Audit log | `audit_log` | 020 / 021 | Unified append-only audit ledger. |
| Spend entry | `spend_entries` | 015 / 021 | Per-token or per-tool billing entry. |
| Budget alert | `budget_alerts` | 015 / 021 | Threshold alert for a team or agent. |
| Agent execution | `agent_executions` | 015 / 021 | Internal record of one agent invocation inside a run. |
| Agent heartbeat | `agent_heartbeats` | 015 / 021 | Liveness ping for an in-flight agent execution. |
| Company lifecycle | `company_lifecycle`, `company_lifecycle_audit` | 013 / 021 | Pause/resume state machine for a company. |

## Memory + scheduling

| Canonical noun | Table | Migration | Description |
|---|---|---|---|
| Workspace instruction | `workspace_instructions` | 034 | Layer-1 always-on prompt steering at the workspace level. |
| Knowledge item | `knowledge_items` | 034 | Layer-2 retrieval-augmented memory shared across agents. |
| Agent episode | `agent_episodes` | 034 | Layer-3 per-agent run-scoped episodic memory. |
| Wake event | `wake_events` | 035 | Scheduler events that wake routines / agents on a trigger. |

## Pre-021 renames (kept for history)

| Canonical name | Pre-021 name |
|---|---|
| `companies` | `provisioned_companies` |
| `agents` | `control_plane_agents` |
| `agent_teams` | `control_plane_teams` |
| `agent_executions` | `control_plane_executions` |
| `agent_tasks` | `control_plane_tasks` |
| `agent_heartbeats` | `control_plane_heartbeats` |
| `spend_entries` | `control_plane_spend_entries` |
| `budget_alerts` | `control_plane_budget_alerts` |
| `audit_log` | `control_plane_audit_log` + `control_plane_secret_audit` |
| `company_lifecycle` | `control_plane_company_lifecycle` |
| `company_lifecycle_audit` | `control_plane_company_lifecycle_audit` |
| `llm_credentials` | `llm_configs` |
| `approvals` | `approval_requests` |
| `activity_events` | `observability_events` |

## Rule

> Do not use `control_plane_*`, `provisioned_*`, `llm_configs`, or
> `workflow_template*` in any customer-facing surface (`dashboard/`, `landing/`,
> `docs/`). The CI grep guard in `.github/workflows/ci.yml` enforces the
> first three; HEL-119 is replacing `workflow_template*` with `workflow_*` on
> the wire (the deprecated names are still emitted for one release of
> back-compat).
>
> The `src/controlPlane/` module directory is intentionally preserved — it is
> an internal implementation namespace, not a customer-facing noun.

## Tables intentionally not renamed

| Table | Reason |
|---|---|
| `provisioned_company_secrets` | Still valid name; FK to `companies` auto-updated. |
| `agent_heartbeat_logs` | Legacy; `agentMemoryStore.ts` manages its own DDL inline. |
| `memory_entries` | Legacy; referenced by `runtimeRetention.ts`. |
| `observability_events` | Legacy compatibility; activity feed now materializes from `activity_events`. |

## Wire-shape aliases (in-flight renames)

| Deprecated field | Canonical field | Tracking | Notes |
|---|---|---|---|
| `team.workflowTemplateId` | `team.workflowId` | HEL-119 | Dual-emitted from `ControlPlaneTeam` until the column rename ships. |
| `team.workflowTemplateName` | `team.workflowName` | HEL-119 | Customer-facing UI must read the canonical alias. |
