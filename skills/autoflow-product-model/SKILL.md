---
name: autoflow-product-model
description: >
  AutoFlow canonical product vocabulary — the authoritative noun list
  every API path, DB table, UI label, doc page, and marketing surface
  must use. Covers the customer-facing terms (Workspace, Company, Mission,
  Hiring plan, Agent, Routine, Workflow, Run, Approval, Ticket, etc.),
  internal-only terms (Workflow runtime, Agent orchestration / control
  plane), the forbidden / reserved words, the v1 MVP end-to-end loop,
  and the four pricing tiers. Use any time you're naming a route, table,
  field, page, modal, or marketing surface.
license: Proprietary. Apache-style with the AutoFlow trademark carve-out.
---

# AutoFlow Canonical Product Model

This is the canonical vocabulary for AutoFlow. The source of truth is
[`docs/glossary.md`](../../docs/glossary.md); this skill is its short-form
agent reference. The CI grep guard in `.github/workflows/ci.yml` enforces
parts of the rule — drift here and the build fails.

The metaphor matters: AutoFlow is a **workplace**, not a workflow tool.
Agents are persistent workers with names, roles, model tiers, tools, budgets,
and a reporting structure. Customers describe a mission; the platform
drafts a hiring plan; the customer confirms; agents are provisioned;
routines kick off; approvals gate the risky steps; activity feeds show
everything happening.

---

## 1. The two architectural layers

The hard-earned design decision that makes the product different:

| Layer | What it is | Code | Tables |
|---|---|---|---|
| **Workflow runtime** | Deterministic DAG executor. Takes a workflow version + input, runs steps, persists step results. n8n / Zapier-equivalent layer. | `src/engine/WorkflowEngine.ts`, `src/workflows/` | `workflow_runs`, `workflow_step_results`, `workflow_queue_jobs` |
| **Agent orchestration** (a.k.a. control plane) | Sits **above** the workflow runtime. Owns persistent agents, their org structure, what each is working on, costs, lifecycle. | `src/controlPlane/` | `agents`, `agent_teams`, `agent_executions`, `agent_tasks`, `agent_heartbeats`, `spend_entries`, `budget_alerts`, `company_lifecycle`, `audit_log` |

Both are kept distinct in code but **flattened into one customer vocabulary
in the UI and DB**. Customers think "my agents," "my budgets," "my activity"
— they don't think "control plane" or "workflow runtime."

---

## 2. The customer-facing nouns (use these)

Every API path, DB column, UI label, doc page, and marketing copy uses these
exact words.

| Noun | Table | Description |
|---|---|---|
| Workspace | `workspaces` | Tenancy boundary. Every customer-facing row is scoped here. |
| Workspace member | `workspace_members` | User ↔ workspace edge with role (`owner`, `admin`, `billing`, `operator`, `developer`, `approver`). |
| Company | `companies` | A workspace's representation of the business it runs. |
| Mission | `missions` | Free-text statement of what the company is trying to do; drives team generation. |
| Hiring plan | `hiring_plans` | LLM-generated draft team structure awaiting human approval. |
| Agent | `agents` | Persistent named worker (role, model tier, tools, budget). |
| Subagent | (`agents` + `org_edges`) | An agent that reports to another agent. |
| Org structure / Org edge | `org_edges` | Manager → report graph between agents. |
| Agent team | `agent_teams` | Named group of agents executing one workflow. |
| Routine | `routines` | Scheduled or triggered run definition for a workflow. |
| Workflow | `workflows` | DAG of steps that a routine runs. Owns one or many versions. |
| Workflow version | `workflow_versions` | Immutable versioned snapshot (replays + audit). |
| Run | `runs` | One execution of a specific workflow version on specific input. |
| Step result | `step_results` | Output / cost / duration / error for one node within a run. |
| Approval | `approvals` | Human-in-the-loop gate inside a run. Tier-policied. |
| Activity event | `activity_events` | Workspace-scoped append-only feed. |
| Ticket | `agent_tasks` | Long-lived assignable unit of work. |
| Connector connection | `connector_connections` | Workspace-bound credential for an integration. |
| LLM credential | `llm_credentials` | Workspace-bound provider API key (BYOK). |
| Budget | `budgets` | Spend cap per agent or per workspace; enforced before LLM/tool calls. |
| Subscription | `subscriptions` | Stripe subscription bound to a workspace. |
| Entitlement | `entitlements` | Resolved per-workspace plan limits driving `requireEntitlement()`. |
| Audit log | `audit_log` | Unified append-only audit ledger. |
| Workspace instruction | `workspace_instructions` | Layer-1 always-on prompt steering at the workspace level. |
| Knowledge item | `knowledge_items` | Layer-2 retrieval-augmented memory shared across agents. |
| Agent episode | `agent_episodes` | Layer-3 per-agent run-scoped episodic memory. |

---

## 3. Internal-only nouns (never appear in customer surfaces)

| Noun | Where | Why hidden |
|---|---|---|
| Workflow runtime | `src/engine/` | Internal architectural layer |
| Agent orchestration / Control plane | `src/controlPlane/` | Same |
| Agent execution | `agent_executions` | Internal record of one agent invocation inside a run |
| Agent task | `agent_tasks` | Customer-facing alias is **Ticket** |
| Agent heartbeat | `agent_heartbeats` | Liveness ping; internal-only |
| Spend entry | `spend_entries` | Per-token billing entry; surfaces aggregated as **Budget** |
| Budget alert | `budget_alerts` | Internal threshold record |
| Company lifecycle | `company_lifecycle` | Pause/resume state machine |
| Observability event | `observability_events` | Legacy compat; materializes the **Activity** feed |
| Agent memory | `memory_entries`, `agent_heartbeat_logs` | Legacy structures behind the three-layer model |
| Wake event | `wake_events` | Scheduler events |

The `src/controlPlane/` module directory is intentionally preserved — it is
an internal implementation namespace, not a customer-facing noun.

---

## 4. Reserved / forbidden words

**Never** use these in customer-facing surfaces (`dashboard/`, `landing/`,
`docs/`) — the CI grep guard rejects the first three:

| Forbidden | Use instead |
|---|---|
| `control_plane_*` | `agent_*` (e.g. `agent_executions`, not `control_plane_executions`) |
| `provisioned_*` | direct noun (e.g. `companies`, not `provisioned_companies`) |
| `llm_configs` | `llm_credentials` |
| `workflow_template*` | `workflow_*` (HEL-119, deprecation in progress) |
| "Job" | use **Run** (for one execution) or **Routine** (for a recurring definition) |
| "Pipeline" | use **Workflow** |
| "Bot" | use **Agent** |
| "Worker" (for the agent) | use **Agent** |
| "Account" | use **Workspace** (tenancy) or **Workspace member** (user) |

The word "worker" remains legal **only** for the BullMQ process
(`src/worker.ts`) — that's a queue consumer, not a customer-facing concept.

---

## 5. In-flight renames (be careful)

Dual-emitted fields with both legacy + canonical names until the migration
ships:

| Deprecated field | Canonical field | Tracking |
|---|---|---|
| `team.workflowTemplateId` | `team.workflowId` | HEL-119 |
| `team.workflowTemplateName` | `team.workflowName` | HEL-119 |

Customer-facing UI must read the **canonical** alias. Backend reads can use
either while HEL-119 is in flight, but new code shouldn't introduce the
deprecated shape.

---

## 6. The v1 MVP end-to-end loop

This is the whole product loop — anything not on this list is post-MVP:

```
Sign up
  → create workspace + company
  → describe mission
  → review LLM-generated hiring plan
  → confirm agents + org chart
  → connect 1–2 tools (Slack, Gmail, HubSpot, Linear, GitHub, Stripe...)
  → add LLM key (BYOK) or use hosted models with tier routing
  → deploy a routine
  → first run
  → approval / ticket if a step needs human sign-off
  → see activity + cost
  → scheduled re-runs work reliably
```

When proposing new features, check whether they sit on this loop or expand
it. Expansion needs a separate ticket and product approval — keep the loop
tight.

---

## 7. Pricing tiers

| Tier | Position | Notes |
|---|---|---|
| **Explore** | Free signup tier | 1 agent, 25 runs/mo, hosted models (BYOK temporarily allowed while hosted-free is being built) |
| **Flow** | Entry paid | Small workspace, capped runs/month |
| **Automate** | Pro | More agents, more runs, **BYOK enabled** (Anthropic / OpenAI / Google / Bedrock / Mistral), integrations expand |
| **Scale** | Enterprise | SSO, audit log, MSA path, custom limits |

Stripe price IDs are wired (`STRIPE_FLOW_PRICE_ID`, `STRIPE_AUTOMATE_PRICE_ID`,
`STRIPE_SCALE_PRICE_ID`). Enforcement at the API via `requireEntitlement()` —
see the autoflow-billing skill.

---

## 8. Differentiation language

When writing copy or explaining the product:

- **vs n8n** — AutoFlow has agents as **first-class persistent workers**, not
  just nodes. You don't build a workflow and run it; you hire an agent and
  the agent runs workflows on a schedule, with budgets, with approvals,
  with memory. n8n is a workflow tool; AutoFlow is a workplace.
- **vs Zapier** — AutoFlow is **AI-native by design**. BYO LLM key with tier
  routing (Lite / Standard / Power) so cheap calls route cheap. Per-agent
  budgets enforced before each step. Tickets and approvals as first-class
  HITL, not a "wait for human" hack. And the org-structure layer is unique
  — Zapier doesn't have a notion of agent → manager-agent → mission.
- **vs the dozens of "AI agent" startups** — most are demos. AutoFlow has a
  real codebase (60+ DB tables, 90 dashboard pages with tests, full Stripe
  stack, 17 integrations scaffolded, multi-cloud deploy, CIAM auth) — the
  work is converging it into a tight customer loop, not building from zero.

---

## 9. Forbidden patterns

- ❌ Inventing new nouns ("Bots", "Jobs", "Pipelines") for customer surfaces.
- ❌ Leaking `control_plane_*` / `provisioned_*` / `llm_configs` into
  `dashboard/`, `landing/`, or `docs/` — CI blocks this.
- ❌ Renaming a customer noun without updating `docs/glossary.md` in the
  same PR.
- ❌ Treating "Job" as interchangeable with "Run" or "Routine".
- ❌ Routing a brand-new architectural concept directly into the customer
  vocabulary — internal-only words belong in `src/` only.
