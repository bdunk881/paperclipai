# AGENTS.md

> The canonical operating manual for **every** agent and human contributor working in this repo. Claude Code, Cursor, Codex, and any future tool all read this file. If anything in your tool's chat conflicts with what's here, this file wins.

---

## What is AutoFlow?

AutoFlow is an **AI agent orchestration platform** — a SaaS that lets a small business or operator hire, manage, and budget a team of AI agents the same way they'd hire a team of people. The product is the love-child of three categories: **n8n** (visual workflow builder), **Zapier** (connect-any-app integration platform), and a true **agent orchestration layer** that turns workflows into a persistent workforce.

The metaphor matters. Most "AI workflow" tools today treat agents as nodes in a graph — disposable, per-step, per-prompt. AutoFlow treats agents as **persistent workers** with names, roles, model tiers, tools, budgets, and a reporting structure. Customers describe a *mission* in plain English; the platform drafts a *hiring plan* (an org chart of agents); the customer reviews and confirms; agents are provisioned with persistent identity; routines kick off; humans gate the risky steps via approvals; the activity feed shows everything happening, in real time, with cost attribution.

### The two architectural layers

This is the hard-earned design decision that makes the product different:

- **Workflow runtime** — a deterministic DAG executor. Takes a workflow version + input, runs steps, persists step results. This is the n8n/Zapier-equivalent layer. Code: `src/engine/WorkflowEngine.ts`, `src/workflows/`. Tables: `workflow_runs`, `workflow_step_results`, `workflow_queue_jobs`.
- **Agent orchestration** (a.k.a. *control plane*) — sits **above** the workflow runtime. Owns persistent agents, their org structure, what each agent is currently working on, their costs, their lifecycle. Without this layer, you'd have workflows-with-LLM-calls (Zapier+OpenAI). With it, you have agents-that-run-workflows-as-routines. Code: `src/controlPlane/`. Tables: `agents`, `agent_teams`, `agent_executions`, `agent_tasks`, `agent_heartbeats`, `spend_entries`, `budget_alerts`, `company_lifecycle`, `audit_log`.

The two layers are kept distinct in code (the `src/controlPlane/` module is a real architectural unit) but flattened into one customer-facing vocabulary in the UI and DB names. Customers think "my agents," "my budgets," "my activity" — they don't think "control plane" or "workflow runtime."

### The end-to-end product loop (the v1 MVP)

> **Sign up** → **create workspace + company** → **describe mission** → **review LLM-generated hiring plan** → **confirm agents + org chart** → **connect 1–2 tools** (Slack, Gmail, HubSpot, Linear, GitHub, Stripe...) → **add LLM key** (BYOK) or use hosted models with tier routing → **deploy a routine** → **first run** → **approval / ticket** if a step needs human sign-off → **see activity + cost** → **scheduled re-runs work reliably**.

That's the whole MVP. Anything not on this list is post-MVP.

### How it differs from n8n and Zapier

- **vs n8n**: AutoFlow has agents as first-class persistent workers, not just nodes. You don't build a workflow and run it — you hire an agent and the agent runs workflows on a schedule, with budgets, with approvals, with memory. n8n is a workflow tool; AutoFlow is a workplace.
- **vs Zapier**: AutoFlow is AI-native by design. BYO LLM key (Anthropic, OpenAI, Google, Bedrock, Mistral) with tier routing (Lite / Standard / Power) so cheap calls route cheap. Per-agent budgets enforced before each step. Tickets and approvals as a first-class HITL surface, not a Zapier "wait for human" hack. And the org-structure layer is unique — Zapier doesn't have a notion of agent → manager-agent → mission.
- **vs the dozens of "AI agent" startups**: most are demos. AutoFlow has a real codebase (60+ DB tables, 90 dashboard pages with tests, full Stripe stack, 17 integrations scaffolded, multi-cloud deploy, Microsoft-grade auth) — the work is converging it into a tight customer loop, not building from zero.

### Pricing (3 tiers)

- **Flow** — entry tier; small workspace, capped runs/month, hosted models only.
- **Automate** — pro tier; more agents, more runs, BYOK enabled, integrations expand.
- **Scale** — enterprise; SSO, audit log, MSA path, custom limits.

The Stripe price IDs are wired (`STRIPE_FLOW_PRICE_ID`, `STRIPE_AUTOMATE_PRICE_ID`, `STRIPE_SCALE_PRICE_ID`); enforcement at the API via the `requireEntitlement()` middleware is in flight.

### Where AutoFlow is *today*

- Open-source on GitHub at [bdunk881/paperclipai](https://github.com/bdunk881/paperclipai), v0.2.0.
- Live demo at [helloautoflow.com/demo](https://helloautoflow.com/demo).
- Posted on Product Hunt.
- **Pre-paying-customer.** First paid customer is the goal of the [Production-Ready SaaS initiative](https://linear.app/helloautoflow/initiative/production-ready-saas-first-paying-customer-6137d1a98469).
- Brand direction: editorial workplace — cream paper + deep ink, terracotta accent, sage / mustard / plum. Fraunces serif + Geist UI + JetBrains Mono. Live design source at `docs/design/v2/`.

### Project goal in one sentence

Compress a sprawling but mature open-source codebase into one sharp customer loop, harden tenancy + billing + persistence + execution, and ship it to paying SMBs while laying the foundations for select enterprise deals.

---

## Stack (target state — current after Azure removal)

| Layer | Service |
|---|---|
| Frontend hosting | Cloudflare Pages/Workers |
| Backend compute | Fly.io (`autoflow-api-{dev,staging,production}` — consolidated TS Express per the [P2.5 backend consolidation](https://linear.app/helloautoflow/project/p25-backend-consolidation-ts-express-on-fly-a2f0e7006ec9). Legacy `autoflow-fastapi-*` relay shims retired in HEL-97 — `api.{dev-,staging-,}helloautoflow.com` now point straight at the Express.) |
| Database + auth (CIAM) | Supabase |
| Cache + queue broker | Upstash Redis (BullMQ in P3) |
| Object storage | Cloudflare R2 |
| Secrets | Infisical (single project `autoflow`, three envs) |
| Observability | Sentry, Datadog, Cloudflare Analytics |
| Billing | Stripe |
| Support | Intercom (we eat our own integration) |

Azure is being dropped (per [HEL-11](https://linear.app/helloautoflow/issue/HEL-11)) — pricing untenable. Vercel was fully retired in HEL-todo-vercel-retire: dashboard + landing + docs all serve from Cloudflare Pages now, with the QA-preview-access edge handler running as a Cloudflare Pages Function (`dashboard/functions/api/qa-preview-access.ts`).

---

## Canonical product model (the nouns)

The single source of truth is [`docs/glossary.md`](docs/glossary.md). Every API path, DB table, UI label, doc page, and marketing surface uses these names. The short list (full definitions in the glossary):

**Customer-facing**: Workspace · Workspace member · Company · Mission · Hiring plan · Agent · Subagent · Org structure · Agent team · Routine · Workflow · Workflow run · Step result · Approval · Ticket · Activity · Connector connection · LLM credential · Budget · Subscription · Entitlements · Audit log.

**Internal architecture only** (never appears in customer surfaces): Workflow runtime · Agent orchestration (control plane) · Agent execution · Agent task · Agent heartbeat · Spend entry · Budget alert · Company lifecycle · Observability event · Agent memory.

**Reserved / forbidden**: don't use "Job," "Pipeline," "Bot," "Worker" (for the agent), "Account." Always use the canonical noun.

---

## Branch flow (current reality)

| Branch | Role | Protection (today) | Protection (target — [HEL-7](https://linear.app/helloautoflow/issue/HEL-7)) |
|---|---|---|---|
| `dev` | Main / integration | None | No force-push, no delete, CI green required |
| `staging` | UAT | Open | PR + 1 approval + green CI; protected against direct push |
| `master` | Production (frozen on older build) | Open | PR + 1 approval + staging-first promotion gate |

`master` is intentionally lagging while the production-ready initiative settles the v2 redesign + foundation. Don't promote to `master` until the initiative explicitly opens that gate.

### How to contribute a change

1. Branch from `dev`: `git checkout -b feature/<short-name>` (humans) or `brad/hel-<n>-<slug>` (agents — Linear provides the canonical branch name on each issue).
2. Open the PR into `dev` in the same heartbeat as the first push.
3. Enable auto-merge after CI passes.
4. Promotion to `staging`: separate PR, requires approval.
5. Promotion to `master`: separate PR, requires approval **and** a clean staging history.

**Never:**
- Push directly to `dev`, `staging`, or `master`.
- Use `--no-verify`, `--no-gpg-sign`, or any other hook bypass.
- Modify branch protection settings (that's Brad-only via [HEL-7](https://linear.app/helloautoflow/issue/HEL-7)).
- Force-push a published branch.
- Delete or change priority on a Linear ticket.
- Expand scope without filing a separate ticket.
- Paste a real secret value into Linear, GitHub, Slack, or any chat surface.

---

## Environments

| Env | Supabase project | Fly app | Cloudflare Pages | Notes |
|---|---|---|---|---|
| Dev | `autoflow-dev` (isolated) | `autoflow-api-dev` (TS Express; `dev-api.helloautoflow.com`) | `autoflow-dashboard` (preview) | Safe to break. |
| Staging | Production Supabase project (UAT data preserved) | `autoflow-api-staging` (TS Express; `staging-api.helloautoflow.com`) | `autoflow-dashboard-staging` | Beta accounts live here. |
| Production | Production Supabase project | `autoflow-api-production` (TS Express; `api.helloautoflow.com`) | `autoflow-dashboard` | Real customers (when they arrive). |

**Never point dev code or dev deploy secrets at the production Supabase project.** Single most common foot-gun in this repo.

---

## Secrets

Single source of truth: **Infisical**, project `autoflow`, three environments (`dev` / `staging` / `production`). See [`docs/secrets.md`](docs/secrets.md).

- `infisical login` once per machine.
- `infisical run --env=<env> -- <command>` for every dev command.
- CI pulls via `Infisical/secrets-action@v1`.
- Fly machines pull via `infisical run` in the Dockerfile entrypoint.
- Cloudflare Pages syncs from Infisical (already configured by Brad).

Never paste a secret into a PR, comment, config file, or chat. Rotation procedures by class are in [`docs/secrets.md`](docs/secrets.md).

---

## Linear ticket policy (mandatory for every PR)

Every code change starts in Linear. No untracked PRs.

### One-off PR → one Linear issue

Before touching code or opening a PR, create (or confirm) a Linear issue in the Helloautoflow team. The PR then follows "Working a single ticket" below: branch name = Linear's `gitBranchName`, PR title `"<HEL-N> <issue title>"`, body opens with `Closes HEL-N`. Move the issue to `In Progress` at branch time, `Done` on merge.

"One-off" = all of these are true:
- One mergeable PR, no follow-up planned.
- Single concern, reviewable in one pass (rule of thumb: <500 LOC).
- No schema migration another ticket depends on.

If any of those breaks, it's multi-PR work — see below.

### Multi-PR work → Linear project with sub-issues

When a change spans more than one mergeable PR (feature build, multi-step refactor, schema + code + UI rollout), do **not** file a flat list of unparented issues. Instead:

1. Create a Linear **project** under the appropriate phase (P0–P7) with scope and acceptance criteria in the description.
2. File each PR-sized unit of work as a sub-issue attached to that project (via `parent_id` and the project's Issues list).
3. Apply the one-off rules per sub-issue (branch, PR title, `Closes HEL-N`).
4. Never push code against the parent project ticket itself — pick a sub-issue (see "Parent ticket detected" in stop conditions).

### Required labels on every issue

Each issue carries a **type label**, an **agent label** (or none if Brad-manual), and a **priority**.

**Type label** (at least one; multiples allowed when honest, e.g. `feature` + `security`):

| Label | Use when |
|---|---|
| `feature` | Net-new capability (customer- or internally-facing) that persists past the PR. |
| `troubleshooting` | Investigating an unclear failure or customer report before the cause is known. Re-label `bug` once a code fix lands. |
| `bug` | Defect with a known cause and a code-level fix. |
| `chore` | Dependency bumps, config tweaks, lint cleanup — no behavior change. |
| `refactor` | Restructuring without behavior change, or paying down explicit tech debt. |
| `docs` | Docs-only edits (`docs/**`, `README.md`, `AGENTS.md`, `CLAUDE.md`). |
| `security` | authn/authz, secrets, CVEs, tenancy isolation, audit trail. |
| `spike` | Time-boxed research that ships a doc or follow-up ticket, not code. |
| `hotfix` | Production-blocking; combine with `bug` or `security`. File in the same heartbeat as the PR if speed matters, but file it. |

**Agent label**: `agent:claude-routine` / `agent:cursor` / `agent:codex` if an agent will work it. No agent label = Brad's manual work (per "Routing" below).

**Priority**: P0–P3. Default P3 if unsure; Brad re-prioritizes.

Don't drop the type label to "skip Linear" — that's the foot-gun this rule closes.

### Approved plans go in the ticket

When the user approves an agent's implementation plan — Claude Code's Plan mode / `ExitPlanMode`, Cursor's plan preview, Codex CLI's plan output, or any other "here's what I'll do" sign-off — the agent posts the **full approved plan, verbatim**, as a comment on the Linear ticket **before writing any code**.

- Verbatim, not summarized. The plan is the contract; future reviewers and other agents read it.
- One comment per approved plan. Plan revisions are new comments, not edits — keep the history.
- If the plan changes scope mid-execution, file a separate ticket per the "no scope expansion" rule in the Hard never list; don't silently rewrite the plan in the existing one.
- Applies to sub-issues too: each sub-issue under a project carries the plan for *its* slice of work.

### AGENTS.md / CLAUDE.md / `docs/` edits

Still need a ticket. Drift in operating manuals is itself a P0 (see "When this file is wrong").

---

## How agents work tickets

This repo is multi-agent. Three agents currently work tickets:

- **Claude Code routine** (cloud-hosted, hourly cron) — [routine link](https://claude.ai/code/routines/trig_01Wge2tqiDc16KTbVVtfsVHk). Picks up tickets labeled `agent:claude-routine`.
- **Cursor** (in Brad's IDE) — picks up tickets labeled `agent:cursor`.
- **Codex CLI** (Brad's terminal) — picks up tickets labeled `agent:codex`.

All three follow the same protocol below.

### Routing — pick only your own labeled tickets

When you start work, list Linear issues where:
- `team = Helloautoflow`
- `assignee = me` (the routine owner / Brad)
- `state = "In Progress"`
- `label = agent:<your-name>` (one of `agent:claude-routine`, `agent:cursor`, `agent:codex`)

For the Claude Code routine specifically, the pull query is `team = Helloautoflow`, `assignee = me`, `state = "In Progress"`, and `label = agent:claude-routine`.

If the list is empty, exit cleanly. Do not pick up tickets without your label — another agent owns them. Tickets with no agent label are Brad's manual work.

### Working a single ticket

1. **Move the ticket to `In Progress`** (the routine does this automatically when picking from `Todo`; a human-driven agent like Cursor moves it via Linear).
2. **Comment a kickoff note** on the Linear ticket: what you plan to do, any constraints (e.g., "no `gh` auth this session, will draft only"). If the user has approved an explicit plan (Claude Code Plan mode, Cursor plan preview, Codex CLI plan output), paste the **full plan verbatim** as a comment first — see "Linear ticket policy → Approved plans go in the ticket."
3. **Branch off `dev`** using the branch name Linear provides on the issue (`gitBranchName` field — stable across re-opens).
4. **Read the issue description fully — it IS the spec.** Implement the work.
5. **Run repo-defined tests and typechecks**: `npm test`, `npm run type-check`, `npm run lint` plus dashboard / landing equivalents if relevant.
6. **Commit cleanly** (NEVER use `--no-verify` or `--no-gpg-sign`). Push the branch.
7. **Open a PR into `dev`** via `gh pr create --base dev --title "<HEL-N> <issue title>" --body "Closes HEL-N\n\n<short summary>"`.
8. **Comment the PR URL** on the Linear ticket.
9. **Stop** — wait for CI / the next pickup cycle.

### When the PR is ready

- **PR merged** → set the Linear issue state to `Done` and proceed to auto-promote.
- **PR open + CI failing** → comment a concise failure summary on the Linear issue, add label `ci-failure`. STOP for this run; do not pick a new ticket.
- **PR open + CI green and not yet merged** → comment "PR ready for review/merge: <url>". STOP.

### Auto-promotion (only after marking Done)

- List Backlog + Todo issues in the **same phase project** as the just-completed issue, ordered by priority ascending.
- Filter out any whose `blockedBy` array contains an issue not yet `Done` or `Canceled`.
- Filter out any without your `agent:<name>` label.
- For the Claude Code routine, only auto-promote Backlog/Todo tickets that also have `agent:claude-routine`.
- If none qualify in the same phase project, **STOP** — do NOT advance to the next phase project. That's a human decision.
- Otherwise: set the top qualifying ticket's state to `In Progress`, comment "Auto-promoted from <previous-HEL-id>", and begin step 4 above on the next run.

### Stop conditions (label and exit, do not pick a new ticket)

- **3 consecutive CI failures** despite reasonable fix attempts → label `ci-failure`, comment failure summary.
- **Spec ambiguity** that you cannot resolve from the repo, the linked plan, or [`docs/glossary.md`](docs/glossary.md) → label `needs-human`, comment the precise question.
- **Linear MCP unavailable** in your environment → final message explaining the gap; do not fall back to direct API calls without an explicit token.
- **`gh` CLI unauthenticated** → don't attempt commits; final message explaining the gap.
- **Parent ticket detected** (one with sub-tickets via `parent_id`) — don't try to "implement" it. Pick a sub-ticket instead, or skip and pick another ticket.

### Hard "never" list

- Never push directly to `dev`, `staging`, or `master`.
- Never bypass CI or commit hooks.
- Never alter branch protection or repo settings.
- Never delete a Linear ticket or change its priority.
- Never expand scope without filing a separate ticket.
- Never paste a real secret value anywhere.
- Never modify another agent's labeled tickets.

---

## v2 design

The current product target is the **v2 editorial workplace** redesign. Reference assets live in the repo at [`docs/design/v2/`](docs/design/v2/) (canonical) and [`docs/design/legacy/`](docs/design/legacy/) (the original Electric Lab pass, for reference only).

When implementing UI work:
- Lift design tokens from [`docs/design/v2/styles.css`](docs/design/v2/styles.css) (the `:root` block) into `dashboard/tailwind.config.js`.
- Match the visual output of the prototype HTMLs; don't copy the prototype's internal structure unless it happens to fit.
- Don't ship the design's tweaks panel (it's an internal exploration tool).

Per-page port is tracked under [HEL-32](https://linear.app/helloautoflow/issue/HEL-32). Tokens lift is [HEL-30](https://linear.app/helloautoflow/issue/HEL-30). Layout replacement is [HEL-31](https://linear.app/helloautoflow/issue/HEL-31).

---

## Operational links

- **Linear initiative**: [Production-Ready SaaS — first paying customer](https://linear.app/helloautoflow/initiative/production-ready-saas-first-paying-customer-6137d1a98469)
- **Phase projects**: P0 — Foundations · P1 — Production foundation · P2 — First customer loop · P3 — Durable execution · P4 — Connector + LLM hardening · P5 — Customer readiness · P6 — Enterprise readiness · P7 — Sales + marketing motion
- **Routing handoff doc**: [`docs/agent-handoff.md`](docs/agent-handoff.md) — the heuristics Brad uses to choose which agent gets which ticket
- **Glossary**: [`docs/glossary.md`](docs/glossary.md)
- **Secrets**: [`docs/secrets.md`](docs/secrets.md)
- **Roadmap (auto-generated from Linear)**: [`docs/roadmap.md`](docs/roadmap.md) (TODO)

---

## Memory + plans

- **Persistent agent context for Brad's local machine** lives at `C:\Users\bdunk\CLAUDE.md` (machine-level setup) and `C:\Users\bdunk\.claude\memory\*.md` (auto-memory).
- **Project-level decisions** for AutoFlow live in this file (`AGENTS.md`) and in [`docs/`](docs/).
- **Tool-specific shims**: `CLAUDE.md` is a 3-line pointer to this file. `.cursor/rules/00-agents.mdc` loads this file as Cursor context. Codex reads `AGENTS.md` natively.

---

## Cross-model agents + the three-layer memory model

Shipped via the [P2.5 — Backend consolidation](https://linear.app/helloautoflow/project/p25-backend-consolidation-ts-express-on-fly-a2f0e7006ec9). The runtime architecture:

### Tier routing (HEL-81)

Each workspace stores a `tier_routing` JSONB matrix mapping logical tiers → concrete `{provider, model, credential_id}`. Five tiers: `small / medium / large / embeddings / vision`. Smart defaults inferred from connected BYOK providers; per-agent override via `agents.tier_overrides`. Resolver: `src/llmConfig/tierRouter.ts:resolveTier()`. Every downstream feature (triage, agent reasoning, embeddings) references tiers, never specific models — so a Claude-only workspace and an OpenAI-only workspace use the same code path.

### Provider adapters (HEL-82)

`src/llmConfig/adapters/` normalizes provider wire formats behind a single `NormalizedRequest` / `NormalizedResponse` shape. v1 ships Anthropic + OpenAI; Gemini + Mistral are follow-up tickets. Tool calls + JSON-schema structured outputs work uniformly across providers.

### Three-layer memory (HEL-86 → HEL-91)

| Layer | Table | Role |
|---|---|---|
| 1 — Instructions | `workspace_instructions` | Human-authored markdown, always inlined into agent system prompts at boot. Also stores per-agent `triage_policy` rows. |
| 2 — Knowledge | `knowledge_items` | Durable RAG-retrievable facts: uploaded docs, connector pulls, synthesized patterns. pgvector. Conflict via `superseded_by`. |
| 3 — Episodes | `agent_episodes` | Append-only log of observations / action results / reflections / escalations. 90-day TTL. Reflection (HEL-91) graduates patterns to Layer 2. |

Two visibility scopes only: `autoflow_curated` (global, AutoFlow-managed) and `workspace`. `mission_id` + `author_agent_id` are retrieval-relevance tags, **never** visibility walls — memory is shared across all agents in a workspace by default.

The retrieval ranker (HEL-89) is org-chart-aware: a subagent's manager's memories rank higher than a stranger agent's. Generic vector retrieval treats agents as isolated; AutoFlow's are employees with reporting lines.

### Event-driven wake-ups (HEL-94)

Heartbeat polling is too expensive. Each potential wake source (scheduled cron, inbound webhook, @-mention, approval resolution, direct user message, upstream completion) publishes to `wake_events` → triage layer applies the agent's own `triage_policy` → `ACT / DEFER / IGNORE / ESCALATE` decision persisted back. The triage call uses the **agent's own authored policy** executed cheaply (tier=small), not generic external judgment. ACTed events kick off real agent boots.

---

## Ops cadence

- **Status updates**: weekly summary in the AutoFlow Linear project's status field.
- **Sentry / alerts**: founder-only on-call. Pages forward to phone via Sentry → PagerDuty (after [HEL-#](https://linear.app/helloautoflow/team/HEL/active)).
- **Backups**: Supabase automated daily; restore drill scheduled in P5.
- **Secrets audit**: monthly per [`docs/secrets.md`](docs/secrets.md).

---

## When this file is wrong

If you (a future agent or contributor) find this file describes a flow that no longer matches reality, **fix the file in the same PR** as whatever change made it wrong. Drift in `AGENTS.md` is itself a P0 — it leads agents astray and the cost compounds.

---

## Cursor Cloud specific instructions

### Services overview

| Service | Directory | Start command | Port |
|---------|-----------|---------------|------|
| Backend API (Express + TS) | `/workspace` (root) | `AUTOFLOW_ALLOW_INMEMORY=true NODE_ENV=development npx ts-node --transpile-only src/index.ts` | 3000 |
| Dashboard (Vite + React) | `/workspace/dashboard` | `npm run dev:no-secrets` | 5173 |

The dashboard Vite dev server proxies `/api` requests to the backend at `localhost:3000`.

### Running without external services

The backend supports a **double-locked in-memory fallback** (HEL-80): set `AUTOFLOW_ALLOW_INMEMORY=true` + `NODE_ENV=development` (or `test`) to run without Postgres or Redis. This is sufficient for local development, tests, and CI. The in-memory store is never allowed in production.

### Key gotchas

- **`ts-node` requires `--transpile-only`**: The root `dev:no-secrets` script calls `ts-node src/index.ts`, but `ts-node` is not in production dependencies. After `npm install`, use `npx ts-node --transpile-only src/index.ts` to skip type-checking at startup (avoids TS7016 errors in passport typings that are harmless at runtime).
- **Sentry warning is expected**: On startup without `SENTRY_DSN`, the backend logs `[sentry] SENTRY_DSN is unset`. This is safe to ignore in local/cloud dev.
- **Dashboard auth requires env vars**: Copy `dashboard/.env.local.example` → `dashboard/.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from **autoflow-dev**. Without them, login is disabled with a configuration warning.
- **Backend JWT verification**: Set `SUPABASE_URL` to the **same** project for API Bearer auth. Allow `http://localhost:5173/auth/callback` and `http://localhost:5173/reset-password` in Supabase Auth URL configuration.
- **PKCE storage**: Supabase auth state uses `localStorage` (not `sessionStorage`) so magic-link and recovery emails work when opened in a new tab.
- **Port conflicts**: Both the dashboard and landing site default to port 5173. Only run one at a time, or override with `--port`.

### Test commands

| Scope | Command | Directory |
|-------|---------|-----------|
| Backend unit/integration | `npm test` | root |
| Backend type-check | `npx tsc --noEmit` | root |
| Dashboard unit | `npm test` | `dashboard/` |
| Dashboard lint | `npm run lint` | `dashboard/` |
| Dashboard type-check | `npm run type-check` | `dashboard/` |

All backend tests use the in-memory fallback automatically (via `jest.env.cjs` which sets `AUTOFLOW_ALLOW_INMEMORY=true`).
