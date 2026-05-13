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
| Backend compute | Fly.io (`autoflow-fastapi-{dev,staging,production}`) |
| Database + auth (CIAM) | Supabase |
| Cache + queue broker | Upstash Redis (BullMQ in P3) |
| Object storage | Cloudflare R2 |
| Secrets | Infisical (single project `autoflow`, three envs) |
| Observability | Sentry, Datadog, Cloudflare Analytics |
| Billing | Stripe |
| Support | Intercom (we eat our own integration) |

Azure is being dropped (per [HEL-11](https://linear.app/helloautoflow/issue/HEL-11)) — pricing untenable. Vercel is sundowning where landing isn't already on Cloudflare Pages.

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
| Dev | `autoflow-dev` (isolated) | `autoflow-fastapi-dev` | `autoflow-dashboard` (preview) | Safe to break. |
| Staging | Production Supabase project (UAT data preserved) | `autoflow-fastapi-staging` | `autoflow-dashboard-staging` | Beta accounts live here. |
| Production | Production Supabase project | `autoflow-fastapi-production` | `autoflow-dashboard` | Real customers (when they arrive). |

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
2. **Comment a kickoff note** on the Linear ticket: what you plan to do, any constraints (e.g., "no `gh` auth this session, will draft only").
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

## Ops cadence

- **Status updates**: weekly summary in the AutoFlow Linear project's status field.
- **Sentry / alerts**: founder-only on-call. Pages forward to phone via Sentry → PagerDuty (after [HEL-#](https://linear.app/helloautoflow/team/HEL/active)).
- **Backups**: Supabase automated daily; restore drill scheduled in P5.
- **Secrets audit**: monthly per [`docs/secrets.md`](docs/secrets.md).

---

## Cursor Cloud specific instructions

### Services overview

| Service | Directory | Port | Start command |
|---|---|---|---|
| Express API (TypeScript) | `/workspace` | 3000 | `NODE_ENV=development TS_NODE_TRANSPILE_ONLY=true npm run dev:no-secrets` |
| Dashboard (Vite + React) | `/workspace/dashboard` | 5173 | `VITE_USE_MOCK=true npm run dev:no-secrets` |
| FastAPI (Python) | `/workspace/backend` | 8000 | `uvicorn main:app --host 0.0.0.0 --port 8000 --reload` |

### Key dev caveats

- **Node.js 24** is the CI-pinned version. Use `source /home/ubuntu/.nvm/nvm.sh && nvm use 24` before any Node command.
- **`ts-node` must be installed globally** (`npm install -g ts-node`) — the root `package.json` references it in scripts but does not declare it as a `devDependency`.
- **Express API requires `TS_NODE_TRANSPILE_ONLY=true`** at runtime. Without it, `ts-node` fails on a missing `@types/passport-google-oauth20` declaration that the project does not include. The `tsc --noEmit` type-check passes fine (it uses `tsconfig.json` which is more lenient); this is a `ts-node`-specific quirk.
- **Express API runs in-memory** when `NODE_ENV=development` and no `DATABASE_URL` is set. This is sufficient for local dev and running tests.
- **Dashboard mock mode**: set `VITE_USE_MOCK=true` to run without a real Supabase backend.
- **Python tools** (`uvicorn`, `pytest`, `ruff`, `mypy`) install to `~/.local/bin` — ensure that's on `PATH`.
- **No Infisical required** for local dev: all services have `:no-secrets` script variants or accept environment variables directly.

### Test commands (see README for full list)

- Root backend: `npm test` (Jest, 105 suites)
- Dashboard: `cd dashboard && npm test` (Vitest, 75 suites)
- Python backend: `cd backend && pytest` (137 tests)
- Type-check root: `npx tsc --noEmit`
- Type-check dashboard: `cd dashboard && npm run type-check`
- Lint dashboard: `cd dashboard && npm run lint`
- Lint Python: `cd backend && ruff check .`
- Mypy Python: `cd backend && mypy .`

---

## When this file is wrong

If you (a future agent or contributor) find this file describes a flow that no longer matches reality, **fix the file in the same PR** as whatever change made it wrong. Drift in `AGENTS.md` is itself a P0 — it leads agents astray and the cost compounds.
