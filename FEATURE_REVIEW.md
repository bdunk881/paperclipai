# AutoFlow — Feature Review

**Date:** 2026-06-03
**Reviewer:** Senior product-engineering pass (Claude Code)
**Goal lens:** Everything below is weighted toward **landing the first paying customer** — activation, time-to-value, trust, conversion, retention.
**Method (honest):** This review is grounded in an exhaustive read of the codebase (6 parallel discovery passes over `dashboard/`, `landing/`, `src/`, `migrations/`, `docs/design/v2/`), the canonical `docs/glossary.md`, and all five `docs/audit/*` reports. I did **not** run a live authenticated dashboard session in this pass (fresh worktree, no Supabase/Infisical secrets), so UX critiques are reasoned from code + the v2 prototype HTMLs rather than a clicked-through session. Where I couldn't verify behavior in code, I mark it **(assumption)**. I'd recommend a live walkthrough as the immediate next step — I can drive it.
**Guardrail respected:** The v2 "editorial workplace" design is genuinely simple and that simplicity *is* the product's value. Every UI recommendation reuses existing `af2-*` tokens/components, stays additive, and favors *removing* steps over adding surface area. Mockups are throwaway prototypes in [`/mockups`](mockups/index.html); **no production component was touched.**

---

## 1. Executive summary — the 7 highest-leverage moves

1. **Kill the activation cliff: ship a guided first-run that uses hosted models by default.** Today a brand-new user is forced through MFA, dropped on an empty dashboard, told to "brief your first mission," then **hard-blocked at `/hire` because they have no LLM key** — with no hint that hosted models exist. This is the single biggest barrier between signup and value. → [D1](#d1), mockup [01](mockups/mockup-01-first-run-activation.html). **Quick win, highest ROI.**
2. **Make runs visible — a run timeline / step-result drill-in.** The product's promise is "watch the agents work, with a paper trail," but `GET /api/step-results/:runId` has **no UI** — runs are opaque. → [D2](#d2), mockup [03](mockups/mockup-03-run-timeline.html).
3. **Stop lying to users: honest empty states + no dead controls.** `Memory.tsx` and `BudgetDashboard.tsx` render fake sample data on an empty workspace; several buttons (Activity filters, Board "Approve/Reassign", connector sliders) are no-ops. Nothing erodes a paying evaluator's trust faster. → [U1](#u1)/[U2](#u2), mockup [02](mockups/mockup-02-honest-empty-states.html).
4. **Turn the agent org chart into the actual differentiator.** `OrgStructure` is a collapsible card-list; the org graph (`org_edges`) is AutoFlow's unique wedge and even its own E2E test asserts a visual graph that doesn't exist. → [I1](#i1), mockup [05](mockups/mockup-05-org-chart.html). **Big bet, demo-defining.**
5. **Wire the landing's already-built trust sections.** Testimonials + FAQ Sanity schemas exist but **are never rendered**; there's no `og:image`, no open-source signal, and the hero is hand-drawn art, not the real product. Cheap, high-conversion. → [L1](#l1)/[L2](#l2)/[L3](#l3)/[L4](#l4), mockup [07](mockups/mockup-07-landing-trust.html).
6. **Harden multi-tenant safety before the first customer, not after.** `runs`/`workflows` allow `workspace_id IS NULL` rows visible cross-tenant; Layer-2/3 memory tables are `ENABLE` but not `FORCE` RLS; `mcp_servers.auth_header_value` is plaintext. Small, defensive, trust-critical. → [B4](#b4)/[B6](#b6).
7. **Make the runtime safe to run on >1 machine.** Routine firing, approval-resume, workflow presence and the SSE feed all rely on **per-process in-memory locks** — a second Fly machine double-fires routines and splits the live feed. You'll want HA the day you have a paying customer. → [B1](#b1).

> **What's already good (don't rebuild):** the config-driven integration registry (34 connectors, add-one-object-to-extend); tier routing across 16 provider adapters (a real BYOK story); the org-chart-aware three-layer memory retrieval ranker; SSE live feeds + Yjs collaborative Studio; the budget hook enforced *before each tool call*; AES-256-GCM versioned-key envelope encryption; thorough RLS with NULL-denial; and a genuinely restrained, well-tokenized v2 design system. The bones are strong — this is a convergence problem, not a build-from-zero problem.

---

## 2. Current state (proof of exploration)

### Dev app — `dashboard/` (Vite + React 18/19 + react-router 7 + Tailwind + `af2-*` tokens)

**Shell & IA:** 3-pillar sidebar (Run / Workforce / Build) + topbar with ⌘K command palette, workspace switcher, credits widget, Pro-mode toggle. Routing in [`dashboard/src/router.tsx`](dashboard/src/router.tsx). ~45 live routes + a large set of redirect-only compatibility routes (the v2 consolidation collapsed many pages).

**Feature areas that exist and are largely real:**
- **Onboarding/auth:** email+social login, forced MFA enrollment wizard (passkey/TOTP/email-OTP/magic-link), `OnboardingBanner` + `OnboardingTour`.
- **Workforce/Hiring:** `Hire` (mission intake → LLM hiring plan) → `HiringPlanReview` (confirm agents/tiers) → `MissionState`/`MissionDetail`, `OrgStructure` (card-list), `AgentDetail`/`AgentJobDescription`/`AgentStandingTasks`.
- **Studio:** `WorkflowBuilder` (ReactFlow + Yjs CRDT collaborative canvas + SetupCoach), `Routines` (mine + library), prompt-routine creation.
- **Run/HITL:** `Assignments` (6-tab ticket hub, SSE), `Approvals` (queue/policies/history, SSE), `TicketDetail`.
- **Connect:** `Connections` (Integrations/Models/MCP/Env tabs), `ConnectorHealth`, `LLMProviders`, `McpServers`.
- **Memory:** `Memory` (Instructions/Knowledge/Episodes, scope-filtered).
- **Cost:** `BudgetDashboard` (spend breakdown).
- **Settings/Billing:** `Account`, `Members`, `Billing` (Stripe), `ApiKeys`, notifications, SLA settings.

**Real-time is a genuine strength:** SSE hooks (`useWorkspaceLiveStream`, `useEventStream`) power the activity feed, approvals, tickets and routines streams with exponential-backoff + tab-visibility pausing; `useAgentPresence`/`useWorkflowPresence` give live agent + cursor presence; Studio uses Yjs + `y-websocket`.

**Known soft spots (from `docs/audit/` + code):** invisible LLM-key prerequisite at `/hire`; sample-data fallbacks masking empty states (`Memory`, `BudgetDashboard`); several no-op controls (`Assignments` Activity filters + Board actions, `Connections` permission sliders, env-var button); `OnboardingTour` step-3 anchors a dead route; **no run-detail/step-output drill-in**; org chart is a card-list, not a graph; pricing copy ("Unlimited") contradicts entitlement caps.

### Landing — `landing/` (React Router 7 + Sanity CMS + Stripe Checkout)

**Routes:** `/` (home), `/blog` + `/blog/:slug`, `/demo`, `/signup`, `/privacy`, `/terms`, `/status`, `robots`, `sitemap`. No dedicated `/pricing`, `/features`, `/docs`, `/about`, or `/login` (login is a cross-origin link to the dashboard).

**Home anatomy** ([`landing/app/page.tsx`](landing/app/page.tsx)): nav → hero (*"Hire a team of agents that actually ship"* / *"Hire your first agent →"*) → integration logo strip → competitor-contrast pitch (*"n8n gave you nodes. Zapier gave you triggers. AutoFlow gives you people."*) → 3-step "how it works" (SVG art) → big static dashboard mock (JSX, not a screenshot) → integrations grid → pricing (Explore $0 / Flow $19 / Automate $49 / Scale $99, live from DB + Sanity overlay, wired to Stripe Checkout) → credit packs → bottom CTA → minimal footer.

**The `/demo`** ([`landing/app/demo/page.tsx`](landing/app/demo/page.tsx)) is a **client-side simulator**: three canned templates (lead-enrichment, content-gen, support-bot), `setTimeout`-driven step animation, hardcoded output. Zero backend, no LLM, no signup. It also uses an **indigo Tailwind palette** inconsistent with the home page's paper/ink v2 look.

**Conversion gaps:** testimonials + FAQ schemas exist in Sanity but aren't rendered; no `og:image`/Twitter card; no customer logos or social-proof numbers; no GitHub/open-source signal (despite being MIT OSS); hero art is hand-drawn; CTA verbs are inconsistent; "Watch a 90s demo" links to an interactive simulator, not a video.

### Backend — `src/` (Express + TS on Fly), data — `migrations/` (Supabase Postgres + RLS)

Two-layer architecture per `AGENTS.md`: deterministic **workflow runtime** (`src/engine/`, `src/workflows/`) + **agent control plane** (`src/controlPlane/`). ~60 tables across migrations 001–068+. BullMQ on Upstash Redis with `runs`, `agent-prompt`, `runs-dlq` queues; idempotency via `step_results.idempotency_key`; DLQ on retry-exhaustion. Budget enforced pre-tool-call by `createBudgetHook()`. Strong points: thorough RLS with NULL-denial, AES-GCM versioned-key envelope encryption, Sentry instrumentation, Durable-Object rate limiting. Soft spots: per-process coordinator locks, synchronous LLM calls in request handlers, a stubbed DAG-run worker, and a handful of RLS/index gaps (detailed in §3).

---

## 3. Dev app — findings by lens

### Lens 1 — Gaps / missing features

<a id="d1"></a>**D1. Guided first-run that defaults to hosted models. ⭐ (mockup [01](mockups/mockup-01-first-run-activation.html))**
- **What:** Replace the dead-end first-run with a 3-step activation panel on the empty dashboard: (1) *Pick how your agents think* — **"Use AutoFlow hosted models" selected by default**, "Bring your own key" optional; (2) *Brief your first mission*; (3) *Connect one tool (optional)*. The `/hire` LLM gate should offer hosted models inline instead of redirecting to Connections.
- **Why:** This is the #1 activation killer. New user → forced MFA → empty dashboard → "brief your first mission" → `/hire` → **hard block: "no LLM config"** → manual detour to Connections › Models → BYOK key entry → back. Most evaluators churn here. Hosted models + tier routing already exist (`/api/hosted-free-models`, `src/llmConfig/tierRouter.ts`) — the product *can* generate a plan with zero setup; the UI just never offers it. Directly converts signups → first "wow."
- **Where:** [`dashboard/src/pages/Hire.tsx:405`](dashboard/src/pages/Hire.tsx) (the blocking warning), [`dashboard/src/components/OnboardingBanner.tsx`](dashboard/src/components/OnboardingBanner.tsx), [`dashboard/src/pages/Dashboard.tsx`](dashboard/src/pages/Dashboard.tsx); backend `GET /api/hosted-free-models`, `POST /api/missions/:id/generate-plan`.
- **Sketch:** Add a `workspace_activation` resolver (derive step state from existing data: has-model-config? has-mission? has-connection?) — no schema change needed, compute from existing queries. Render the checklist as a single `Af2Card` on `Dashboard` when the workspace is empty; reuse `EmptyState`/`Af2Button`. In `Hire`, swap the redirect for an inline "Use hosted models / Add your own key" toggle.
- **Effort:** **M** — mostly UI + one read-model; the backend capability already exists.

<a id="d2"></a>**D2. Run timeline / step-result drill-in. ⭐ (mockup [03](mockups/mockup-03-run-timeline.html))**
- **What:** A run-detail view: vertical timeline of steps with per-step status badge, output preview, cost, duration, and error; header with run status, total cost, trigger source, and a **"Replay from step"** action (endpoint already exists).
- **Why:** The differentiator is "watch the agents work with receipts." Today after a routine runs there's **no way to see what happened** — `GET /api/step-results/:runId` and `POST /api/runs/:runId/replay-from-step` exist with zero consumers (`docs/audit/2026-05-18-claude-review.md` H4). Opaque runs kill retention: a customer can't debug, trust, or show their boss what the agents did.
- **Where:** New route `/runs/:runId` in [`dashboard/src/router.tsx`](dashboard/src/router.tsx); data from `GET /api/step-results/:runId`, `GET /api/runs/:id`; replay via `POST /api/runs/:runId/replay-from-step`. Link from `Dashboard` activity rows, `Routines`, `AgentDetail` trace.
- **Sketch:** Reuse `StatusBadge`, `Af2Card`, the existing `useAgentTraceStream` SSE for live runs; render finished runs from REST. Step output in a collapsible `<pre>` with cost/duration meta row. No schema change.
- **Effort:** **M** — endpoints + data exist; this is a focused new page.

<a id="d3"></a>**D3. Surface the Ask-CEO escalation + verify HITL durability. (mockup [06](mockups/mockup-06-approvals-inbox.html))**
- **What:** Add an "Escalations" section to the `Approvals` queue that lists Ask-CEO requests and lets a human resolve them; confirm the `hitl_*` subsystem reads/writes Postgres (migration 041 tables) rather than process memory.
- **Why:** `POST /api/hitl/companies/:companyId/ask-ceo/requests` and the client helper `createAskCeoRequest` exist, but **no component imports them** (`2026-05-18` audit C3) — escalations are invisible. HITL governance is a named wedge; an escalation that goes nowhere is worse than none. The May audit also flagged the HITL store as in-memory (lost on restart); the `hitl_*` tables exist (041) but wiring should be confirmed post-HEL-457.
- **Where:** [`dashboard/src/pages/Approvals.tsx`](dashboard/src/pages/Approvals.tsx); `src/hitl/*`, `src/tickets/`; tables `hitl_ask_ceo_requests`, `hitl_checkpoints`, `approvals`.
- **Sketch:** New tab/section in `Approvals` (the 3-tab hub already exists — add escalations as a queue filter, not a new page, to preserve simplicity). Wire `createAskCeoRequest`/resolve. Add a durability test.
- **Effort:** **M.**

<a id="d4"></a>**D4. Lightweight workspace audit view (not the enterprise pack). (Later-leaning)**
- **What:** A read-only, paginated `audit_log` view scoped to the workspace (auth, billing, connector, llm-credential, budget events) — *not* SOC2/SAML.
- **Why:** `audit_log` table + `auditService` write path exist; there's no read API or UI (`P6` validation: **NOT VERIFIED**). A simple "who did what" view is a real SMB trust signal and a cheap slice of the absent enterprise pack. Full SOC2/SSO is correctly **Later**.
- **Where:** new `GET /api/audit-log` (workspace-scoped, role-gated), `dashboard/src/pages/AuditLog.tsx`. Table exists.
- **Effort:** **M.**

### Lens 2 — UX / UI enhancements

<a id="u1"></a>**U1. Honest empty states (kill prototype-sample fallbacks). ⭐ (mockup [02](mockups/mockup-02-honest-empty-states.html))**
- **What:** Remove the sample-data fallbacks in `Memory` and `BudgetDashboard` (and the `Routines` Library prototype copy); replace with real `EmptyState` + a CTA that moves the user forward.
- **Why:** On an empty workspace these pages render *fabricated* knowledge items / spend numbers, so a new user can't tell real from fake — and the first time they realize the data was theatrical, trust is gone. Honest empty states also double as activation nudges.
- **Where:** [`dashboard/src/pages/Memory.tsx:13`](dashboard/src/pages/Memory.tsx), [`dashboard/src/pages/BudgetDashboard.tsx:295`](dashboard/src/pages/BudgetDashboard.tsx), `Routines.tsx` Library tab. `EmptyState` already exists in `dashboard/src/components/UiStates.tsx`.
- **Effort:** **S.**

<a id="u2"></a>**U2. "No dead controls" sweep — wire or hide.**
- **What:** For each non-functional control, either wire it or hide/disable it with honest affordance: `Assignments` Activity-tab filters (event-type/date/Live have no handlers, `Assignments.tsx:1141`), Board-tab Approve/Edit/Reassign no-ops (`:553`), `Connections` permission sliders (in-place only, `Connections.tsx:13`), env-var button (`:2643`).
- **Why:** A control that does nothing reads as "broken product" to a paying evaluator. Several of these are already being addressed in the HEL-397→442 remediation; this consolidates the remainder.
- **Where:** `dashboard/src/pages/Assignments.tsx`, `Connections.tsx`. Backend `/api/connector-grants` exists for the sliders.
- **Effort:** **S–M** (per control).

<a id="u3"></a>**U3. Fix `OnboardingTour` stale-route steps.**
- **What:** Step 3 targets `nav a[href="/integrations/mcp"]` and step 2 `/mission-assignments` — both changed in the v2 consolidation, so steps silently skip (`docs/audit/2026-06-03-completed-projects-validation.md:70`).
- **Why:** The product tour is a new user's first guided moment; a tour that skips itself is a bad first impression.
- **Where:** [`dashboard/src/components/OnboardingTour.tsx:55`](dashboard/src/components/OnboardingTour.tsx).
- **Effort:** **S.**

<a id="u4"></a>**U4. Surface live-stream connection state.**
- **What:** When `useWorkspaceLiveStream` is `error`/`reconnecting`, show a small "reconnecting…" pill near the activity feed instead of silently going stale.
- **Why:** The feed silently freezes on disconnect today; a tiny indicator preserves trust in real-time-ness. (Low priority, very cheap.)
- **Where:** `dashboard/src/pages/Dashboard.tsx`, `dashboard/src/hooks/useWorkspaceLiveStream.ts`.
- **Effort:** **S.**

### Lens 3 — Backend updates / additions / changes

<a id="b1"></a>**B1. Distributed coordinator locks (make >1 Fly machine safe). ⭐**
- **What:** Move per-process locks to Redis (or BullMQ job schedulers): `promptRoutineCoordinator.inFlight`, `approvalResumeCoordinator.activeResumes`, `presenceStore`, and the observability SSE subscriber registry → Redis pub/sub.
- **Why:** All four are process-local. A second Fly machine **double-fires routines** (the `last_fired_at` stamp races the sweep), **double-resumes approvals**, splits workflow presence, and means SSE clients on machine A never see events written on machine B. You'll want HA (≥2 machines) the moment you have a paying customer — today scaling out is unsafe.
- **Where:** [`src/promptRoutines/promptRoutineCoordinator.ts:36`](src/promptRoutines/promptRoutineCoordinator.ts), [`src/engine/approvalResumeCoordinator.ts:7`](src/engine/approvalResumeCoordinator.ts), [`src/workflows/presenceStore.ts`](src/workflows/presenceStore.ts), [`src/observability/store.ts:29`](src/observability/store.ts).
- **Sketch:** Redis `SET NX PX` distributed lock around each sweep tick (keyed by routine/run id); Redis pub/sub fan-out for SSE; presence in a Redis hash with TTL. Upstash is already the broker.
- **Effort:** **M–L.** **Big bet** for reliability.

<a id="b2"></a>**B2. Queue the synchronous LLM endpoints.**
- **What:** Convert inline LLM calls to job+poll: `POST /api/workflows/generate`, `POST /api/goals/team-assembly`, `POST /api/missions/:id/generate-plan`, and the file-parse in `POST /api/runs/file`.
- **Why:** Each holds an HTTP connection for 10–30s and ties up one of only **10 Postgres pool connections** (`src/db/postgres.ts`). A handful of concurrent "generate plan" clicks can starve the pool and stall the whole API. Hiring-plan generation is the hottest first-run path — exactly where concurrency spikes.
- **Where:** `src/app.ts:2134/2226`, `src/missions/missionRoutes.ts:898`, `src/app.ts:2045`. Reuse the existing BullMQ `agent-prompt`/`runs` infra + a poll endpoint.
- **Effort:** **M.**

<a id="b3"></a>**B3. Finish durable DAG execution (the worker handler is a stub).**
- **What:** Implement `handleRunsJob()` for workflow DAG runs (currently logs only and falls back to the in-process `WorkflowEngine`); delete the legacy `src/engine/queue.ts` Upstash-REST path once done.
- **Why:** The "deterministic DAG executor" is half the product, but DAG runs aren't actually queue-backed (`2026-06-03` validation §4) — they don't survive a restart mid-run the way agent-prompt runs do. (May be tracked as HEL-107+; confirm before filing.)
- **Where:** [`src/worker.ts`](src/worker.ts) `handleRunsJob()`, [`src/engine/queue.ts`](src/engine/queue.ts).
- **Effort:** **M–L.**

<a id="b4"></a>**B4. RLS hardening: FORCE on memory tables + close the nullable-workspace passthrough. ⭐**
- **What:** (a) `ALTER TABLE … FORCE ROW LEVEL SECURITY` on `knowledge_items`, `agent_episodes`, `workspace_instructions`, `wake_events`. (b) Add a `NOT NULL` (or an explicit insert-guard) for `runs.workspace_id`/`routines.workspace_id`, since policies expose `workspace_id IS NULL` rows to every tenant. (c) Unify the dual GUC (`app.current_*` vs `autoflow.user_id`) so memory tables don't depend on a second middleware setting a second variable.
- **Why:** Defensive tenancy. The memory tables are the only customer tables `ENABLE` without `FORCE`; a NULL-workspace `runs` row is visible cross-tenant; the dual-GUC split is a coordination footgun. Cheap to fix now, expensive to discover after onboarding a customer. (The FORCE gap may be moot if the app role isn't the table owner — **verify**, then add for defense-in-depth.)
- **Where:** new migration; [`migrations/034_three_layer_memory.sql:188`](migrations/034_three_layer_memory.sql), `035_*`, [`migrations/023_canonical_workflow_runtime.sql:87`](migrations/023_canonical_workflow_runtime.sql).
- **Effort:** **S–M.**

<a id="b5"></a>**B5. Add missing hot-path indexes.**
- **What:** `runs(workspace_id, status)` composite; `agent_episodes(run_id)`; consider a covering path for `step_results` workspace aggregation used by `BudgetDashboard`.
- **Why:** Today "pending runs for my workspace" and "episodes for run X" do extra passes/seq-scans. Small now, compounding as run volume grows.
- **Where:** new migration; `migrations/023_*`, `034_*`.
- **Effort:** **S.**

<a id="b6"></a>**B6. Encrypt `mcp_servers.auth_header_value` (plaintext today).**
- **What:** Route the MCP auth header through the existing `secretEncryption` envelope instead of storing plaintext (the code comment already flags this as MVP debt).
- **Why:** Customer-supplied bearer tokens for MCP servers sit in plaintext in Postgres — an avoidable secret-at-rest exposure, and a bad look in any security review.
- **Where:** [`src/mcp/mcpStore.ts:26`](src/mcp/mcpStore.ts), reuse [`src/controlPlane/secretEncryption.ts`](src/controlPlane/secretEncryption.ts).
- **Effort:** **S.**

### Lens 4 — Interactive features not yet implemented

<a id="i1"></a>**I1. Agent org-chart / topology visualization. ⭐ (mockup [05](mockups/mockup-05-org-chart.html))**
- **What:** Replace the `OrgStructure` card-list with a real manager→report graph (from `org_edges`), nodes showing live presence (`useAgentPresence`), current task, and month-to-date spend; click a node → `AgentDetail`.
- **Why:** This is the wedge n8n/Zapier structurally can't copy — "a workforce, not a flowchart." It's also the most demo-able screen in the product, and the existing E2E test asserts a graph (`data-testid="org-chart-node"`) that doesn't exist (`P2` validation). High narrative value for sales and activation.
- **Where:** [`dashboard/src/pages/OrgStructure.tsx`](dashboard/src/pages/OrgStructure.tsx); `GET /api/org-graph` already exists; presence via `GET /api/agents/presence/stream`.
- **Sketch:** ReactFlow is already a dependency (Studio uses it) — render a read-only tree layout with `af2-*`-styled nodes (presence dot = sage/mustard/clay, same status semantics as `StatusBadge`). Keep it calm: one node card per agent, generous spacing, progressive disclosure on click. No new tables.
- **Effort:** **M–L.** **Big bet.**

<a id="i2"></a>**I2. Budget/cost dashboard: real spend chart + threshold alerts. (mockup [04](mockups/mockup-04-budget-dashboard.html))**
- **What:** Wire the static SVG area chart to real spend series, and add a budget-ceiling alert banner when a scope crosses its `alert_threshold_pct`.
- **Why:** "Receipts / paper trail" is a core pillar; the chart is currently `// visually static for now` (`BudgetDashboard.tsx:11`) and `budget_ceilings`/`budget_alerts` data isn't surfaced. Cost visibility + "you're at 80% of budget" is exactly what a cost-conscious SMB buyer wants to see before paying.
- **Where:** [`dashboard/src/pages/BudgetDashboard.tsx:11`](dashboard/src/pages/BudgetDashboard.tsx); data from `GET /api/budget/breakdown`, tables `spend_entries`, `budget_ceilings`, `budget_alerts`.
- **Effort:** **M.**

<a id="i3"></a>**I3. Agent memory inspector (lean the memory wedge). (Big bet)**
- **What:** On `AgentDetail`, a timeline of that agent's Episodes (Layer 3) with "graduated to Knowledge" markers (reflection), and a "what this agent knew at step N" peek from a run.
- **Why:** Three-layer org-aware memory is genuinely differentiated but invisible to customers. Making memory legible ("your agent *remembers* and *learns*") is a retention and expansion story competitors can't tell. Backend retrieval ranker + episodes exist.
- **Where:** `dashboard/src/pages/AgentDetail.tsx`; `GET /api/agents/:id/memory`, `/api/episodes`, `/api/knowledge-items`.
- **Effort:** **M–L.** Sequence after I1/D2.

### Lens 5 — Creative differentiators (bigger bets, flagged as such)

<a id="c1"></a>**C1. "Five-minute hire" zero-config sandbox.** A signed-out or just-signed-up user picks a vertical ("I run a Shopify store"), AutoFlow generates a real hiring plan against a **hosted model** with a pre-seeded mission, and shows the org + a simulated first run — *before* any key, connection, or payment. This is D1 + the `/demo` taken to its logical end: the actual product as the demo. Ties the landing's `/demo` to real value. **Big bet.**

<a id="c2"></a>**C2. Vertical "starter teams" from the HEL-225 SMB skill packs.** The repo is hand-authoring SMB skills (Housecall Pro, Guesty, Honeybook, FareHarbor…). Surface them as one-click "starter teams": pick your tools → get a pre-built agent team + routines tuned for that vertical. This is the fastest path to SMB time-to-value and a marketplace seed. **Big bet** (depends on the skills landing on this branch — they're filed, not yet merged here).

<a id="c3"></a>**C3. "Agent standup" digest.** A daily/weekly auto-generated summary (email + in-app) of what the workforce did, what it spent, what's awaiting approval, and what it learned — the manager's-eye view of a team of employees. Leans every wedge (org, budget, HITL, memory) and is a natural retention loop. **Big bet** (builds on D2 + I2 + the activity feed).

---

## 4. Landing page — findings (conversion-weighted)

### Lens 1 — Gaps / missing conversion features

<a id="l1"></a>**L1. Render the trust sections you already built. ⭐ (mockup [07](mockups/mockup-07-landing-trust.html))**
- **What:** Wire the existing **testimonials** and **FAQ** Sanity schemas into the home page, add a Product Hunt badge (you launched there), and a one-line social-proof stat strip.
- **Why:** A cold SMB visitor sees **zero** social proof today — the schemas + GROQ queries exist in `landing/lib/sanity.ts` but the home page never fetches/renders them. This is the cheapest conversion win available: the data layer is done.
- **Where:** [`landing/app/page.tsx`](landing/app/page.tsx) loader + sections; [`landing/lib/sanity.ts:39`](landing/lib/sanity.ts).
- **Effort:** **S.**

<a id="l4"></a>**L4. Open-source / GitHub trust signal.**
- **What:** Add a GitHub link + live star count + "MIT-licensed, self-hostable" badge in nav/footer and near the hero.
- **Why:** AutoFlow *is* OSS, but the landing hides it — while n8n and Activepieces use OSS as their primary trust anchor. For the developer persona in your own positioning brief, this is table stakes; for SMBs it signals "no lock-in."
- **Where:** `landing/app/page.tsx` nav + footer.
- **Effort:** **S.**

### Lens 2 — UX / UI enhancements

<a id="l3"></a>**L3. Replace hand-drawn hero/dashboard art with the real product. (mockup [07](mockups/mockup-07-landing-trust.html))**
- **What:** Swap the JSX "Acme Robotics hiring plan" hero card and the JSX dashboard mock for a real product screenshot (or a short autoplay loop) of the org chart [I1] + run timeline [D2].
- **Why:** A cold visitor's #1 unspoken question is "is this real?" Hand-drawn art answers "maybe not." Real screenshots of distinctive screens (org chart, receipts) are the strongest possible trust + differentiation signal.
- **Where:** `landing/app/page.tsx` hero (lines ~500–628) and dashboard mock (~787–974).
- **Effort:** **S–M** (depends on having I1/D2 to screenshot — sequence after them; an interim real screenshot of today's dashboard still beats the drawing).

<a id="l5"></a>**L5. Demo: honesty + brand consistency + reframe to the wedge.**
- **What:** (a) Relabel "Watch a 90s demo" → "Try the interactive demo"; (b) restyle `/demo` from indigo Tailwind to the v2 paper/ink palette so it matches the home page; (c) reframe the demo around the **hiring-plan** flow (the actual wedge), not generic lead-enrichment.
- **Why:** The label promises a video and delivers a form sim — a small credibility ding. The indigo palette makes `/demo` look like a different product. And a generic "lead enrichment" sim doesn't show what makes AutoFlow different; a "describe a mission → see a team" sim does.
- **Where:** [`landing/app/demo/page.tsx`](landing/app/demo/page.tsx); `landing/app/page.tsx:1174`.
- **Effort:** **M** (full reframe) / **S** (relabel + restyle only).

### Lens 3 — Backend / data (landing)

<a id="l7"></a>**L7. Fix the "Unlimited" pricing drift (correctness).**
- **What:** Reconcile pricing copy with real entitlement caps; have the dashboard `Pricing.tsx` read the DB-backed pricing source the landing already uses.
- **Why:** `dashboard/src/pages/Pricing.tsx` advertises "Unlimited executions/connections" that `src/billing/entitlements.ts` hard-caps (`P7` validation §3). Promising unlimited then enforcing a cap is a churn-and-refund trap with your *first* customer. (Likely already a fileable `bug`.)
- **Where:** [`dashboard/src/pages/Pricing.tsx`](dashboard/src/pages/Pricing.tsx), [`src/billing/entitlements.ts`](src/billing/entitlements.ts), `GET /api/public/landing/pricing`.
- **Effort:** **S.**

<a id="l2"></a>**L2. Add `og:image` + Twitter card meta.**
- **What:** Add OG/Twitter image + card tags to the landing `meta()`.
- **Why:** Every share of helloautoflow.com currently renders a blank image — a silent conversion leak on exactly the channels (Slack, X, LinkedIn) where a founder-led launch spreads.
- **Where:** [`landing/app/page.tsx:22`](landing/app/page.tsx), `landing/app/root.tsx`.
- **Effort:** **S.**

### Lens 4 — Interactive / creative (landing)

<a id="l6"></a>**L6. One primary CTA verb.** Standardize on a single primary action ("Start free" or "Hire your first agent") across nav, hero, footer, pricing — today it's three different verbs. **Effort: S.**

<a id="l8"></a>**L8. Light "vs n8n / vs Zapier" comparison strip.** A compact 3-column "nodes / triggers / **a workforce**" comparison makes the wedge explicit for visitors who don't already get it. Reuse the existing pitch copy. **Effort: S–M.** (See also the live `/demo` sandbox, [C1].)

---

## 5. Prioritized roadmap (Impact × Effort)

Priority key: **Impact** = effect on first-paying-customer (activation/trust/conversion/retention). **Effort** = S/M/L.

### Quick wins (high impact / low effort) — do these first

| # | Surface | Lens | Recommendation | Impact | Effort | Mockup |
|---|---|---|---|---|---|---|
| [D1](#d1) | dev-app | feature/ux | Guided first-run, hosted-models default | ★★★★★ | M | [01](mockups/mockup-01-first-run-activation.html) |
| [U1](#u1) | dev-app | ux-ui | Honest empty states (no fake sample data) | ★★★★ | S | [02](mockups/mockup-02-honest-empty-states.html) |
| [U2](#u2) | dev-app | ux-ui | "No dead controls" sweep | ★★★★ | S–M | — |
| [L1](#l1) | landing | feature | Render testimonials + FAQ + PH badge | ★★★★ | S | [07](mockups/mockup-07-landing-trust.html) |
| [L7](#l7) | landing | backend | Fix "Unlimited" pricing drift | ★★★ | S | — |
| [L2](#l2) | landing | ux-ui | og:image + Twitter card | ★★★ | S | — |
| [B4](#b4) | dev-app | backend | RLS FORCE + nullable-workspace guard | ★★★★ | S–M | — |
| [B6](#b6) | dev-app | backend | Encrypt `mcp_servers` auth header | ★★★ | S | — |
| [B5](#b5) | dev-app | backend | Missing hot-path indexes | ★★ | S | — |
| [L4](#l4) | landing | feature | Open-source / GitHub trust signal | ★★★ | S | [07](mockups/mockup-07-landing-trust.html) |
| [L6](#l6) | landing | ux-ui | One primary CTA verb | ★★ | S | — |
| [U3](#u3) | dev-app | ux-ui | Fix OnboardingTour stale routes | ★★ | S | — |
| [L5](#l5) | landing | ux-ui | Demo: relabel + restyle to v2 | ★★★ | S–M | — |
| [U4](#u4) | dev-app | ux-ui | Live-stream disconnect indicator | ★ | S | — |

### Big bets (high impact / high effort) — fund deliberately

| # | Surface | Lens | Recommendation | Impact | Effort | Mockup |
|---|---|---|---|---|---|---|
| [D2](#d2) | dev-app | interactive | Run timeline / step-result drill-in | ★★★★★ | M | [03](mockups/mockup-03-run-timeline.html) |
| [I1](#i1) | dev-app | interactive | Agent org-chart visualization | ★★★★ | M–L | [05](mockups/mockup-05-org-chart.html) |
| [I2](#i2) | dev-app | interactive | Budget chart + threshold alerts | ★★★★ | M | [04](mockups/mockup-04-budget-dashboard.html) |
| [D3](#d3) | dev-app | interactive | Ask-CEO escalation in Approvals inbox | ★★★ | M | [06](mockups/mockup-06-approvals-inbox.html) |
| [B1](#b1) | dev-app | backend | Distributed coordinator locks (HA-safe) | ★★★★ | M–L | — |
| [B2](#b2) | dev-app | backend | Queue synchronous LLM endpoints | ★★★ | M | — |
| [B3](#b3) | dev-app | backend | Finish durable DAG execution | ★★★ | M–L | — |
| [C1](#c1) | both | creative | "Five-minute hire" zero-config sandbox | ★★★★★ | L | (extends 01) |
| [C2](#c2) | dev-app | creative | Vertical starter-teams (SMB skill packs) | ★★★★ | L | — |
| [L3](#l3) | landing | ux-ui | Real product screenshots in hero | ★★★ | S–M | [07](mockups/mockup-07-landing-trust.html) |
| [L8](#l8) | landing | interactive | "vs n8n/Zapier" comparison strip | ★★★ | S–M | — |
| [I3](#i3) | dev-app | interactive | Agent memory inspector | ★★★ | M–L | — |
| [D4](#d4) | dev-app | feature | Lightweight workspace audit view | ★★ | M | — |
| [C3](#c3) | dev-app | creative | "Agent standup" digest | ★★★ | M–L | — |

### Later / skip (enterprise or low-ROI for the first customer)

| Item | Why later |
|---|---|
| SAML SSO, SOC 2 (Vanta/Drata), MSA/DPA pack | Enterprise readiness (P6). Real, but the first customer is an SMB; revisit when a Scale deal is in hand. |
| Full audit-log UI + CSV export | The lightweight workspace view [D4] is the SMB slice; the full pack is enterprise. |
| HNSW vector index (replace IVFFLAT) | Only matters past ~1M embeddings/workspace; IVFFLAT `lists=100` is fine now. |
| Deep mobile/responsive pass | The buyer evaluates on desktop; revisit if analytics show mobile traffic. |
| "Talk to sales" / enterprise contact path | SMB self-serve is the motion; add when pursuing Scale. |
| Retire legacy redirect routes / `engine/queue.ts` dead code | Hygiene; bundle into B3, don't prioritize standalone. |

---

## 6. Mockups

All mockups are throwaway, self-contained prototypes in [`/mockups`](mockups/index.html), built from the **verbatim `af2-*` design tokens** (cream paper + deep ink, terracotta/sage/mustard/plum accents, Fraunces serif + Geist + JetBrains Mono). Each shows **before → after** where it changes an existing screen, and is annotated with what changed and why it does **not** add complexity. Open [`mockups/index.html`](mockups/index.html) to browse all.

| Mockup | Covers | Shows |
|---|---|---|
| [01 — First-run activation](mockups/mockup-01-first-run-activation.html) | D1 | Empty dashboard: sparse banner → guided checklist w/ hosted-model default |
| [02 — Honest empty states](mockups/mockup-02-honest-empty-states.html) | U1 | Memory/Budget: fake sample data → honest empty state + CTA |
| [03 — Run timeline](mockups/mockup-03-run-timeline.html) | D2 | New run-detail step timeline w/ cost, output, replay |
| [04 — Budget dashboard](mockups/mockup-04-budget-dashboard.html) | I2 | Static chart → real spend chart + threshold alert |
| [05 — Org chart](mockups/mockup-05-org-chart.html) | I1 | Card-list → visual manager→report graph w/ presence |
| [06 — Approvals inbox](mockups/mockup-06-approvals-inbox.html) | D3 | Approvals queue w/ Ask-CEO escalation surfaced |
| [07 — Landing trust](mockups/mockup-07-landing-trust.html) | L1/L3/L4 | Home: + testimonials, FAQ, OSS badge, real hero screenshot |

---

## 7. Suggested sequencing (first 3 sprints toward the first customer)

1. **Sprint 1 — "Activate + don't lie":** D1, U1, U2, L7, L2, B4, B6. (Unblocks signups → value; removes trust-killers; closes cheap tenancy/security gaps.)
2. **Sprint 2 — "Make it legible":** D2, I2, L1, L4, L5. (Runs + cost become visible; the landing earns trust.)
3. **Sprint 3 — "Differentiate + harden":** I1, B1, B2, L3, C1 (kickoff). (The org chart wedge; HA-safe runtime; the real-product landing; the zero-config sandbox bet.)

---

## 8. Linear backlog (filed)

Filed in the **[Feature Review — 2026-06-03](https://linear.app/helloautoflow/project/feature-review-2026-06-03-92ac989490c5)** project (Helloautoflow team, under the *Production-Ready SaaS* initiative). Per your call, only the **genuinely-new, de-duplicated** recommendations were filed — overlapping ones are cross-referenced to their existing projects (below). All carry the `feature-review-2026` batch label for one-shot filtering/rollback. Estimates are story points (S=1, S–M=2, M=3, M–L=5).

### Quick Wins

| Rec | Issue | Surface · labels | Priority | Pts |
|---|---|---|---|---|
| D1 | [HEL-554 — First-run activation: default to hosted models](https://linear.app/helloautoflow/issue/HEL-554) | dev-app · ux-ui, Feature | Urgent | 3 |
| L7 | [HEL-555 — Fix "Unlimited" pricing drift](https://linear.app/helloautoflow/issue/HEL-555) | dev-app · backend, Bug | High | 1 |
| L1 | [HEL-556 — Render testimonials + FAQ on landing](https://linear.app/helloautoflow/issue/HEL-556) | landing · Feature | High | 1 |
| L2 | [HEL-557 — og:image + Twitter card](https://linear.app/helloautoflow/issue/HEL-557) | landing · ux-ui, Improvement | High | 1 |
| L4 | [HEL-558 — Open-source / GitHub trust signal](https://linear.app/helloautoflow/issue/HEL-558) | landing · Improvement | High | 1 |
| B4 | [HEL-559 — RLS hardening (FORCE + nullable-workspace)](https://linear.app/helloautoflow/issue/HEL-559) | dev-app · backend, security | High | 2 |
| B6 | [HEL-560 — Encrypt mcp_servers auth header](https://linear.app/helloautoflow/issue/HEL-560) | dev-app · backend, security | High | 1 |
| B5 | [HEL-561 — Missing hot-path indexes](https://linear.app/helloautoflow/issue/HEL-561) | dev-app · backend, Improvement | Medium | 1 |

### Big Bets

| Rec | Issue | Surface · labels | Priority | Pts |
|---|---|---|---|---|
| D2 | [HEL-562 — Run timeline / step drill-in](https://linear.app/helloautoflow/issue/HEL-562) | dev-app · interactive, Feature | Medium | 3 |
| I1 | [HEL-563 — Agent org-chart visualization](https://linear.app/helloautoflow/issue/HEL-563) | dev-app · interactive, Feature | Medium | 5 |
| I2 | [HEL-564 — Budget chart + threshold alerts](https://linear.app/helloautoflow/issue/HEL-564) | dev-app · interactive, Improvement | Medium | 3 |
| I3 | [HEL-565 — Agent memory inspector](https://linear.app/helloautoflow/issue/HEL-565) | dev-app · interactive, Feature | Medium | 5 |
| B2 | [HEL-566 — Queue remaining sync LLM endpoints](https://linear.app/helloautoflow/issue/HEL-566) | dev-app · backend, Improvement | Medium | 3 |
| L8 | [HEL-567 — "vs n8n/Zapier" comparison strip](https://linear.app/helloautoflow/issue/HEL-567) | landing · interactive, Feature | Medium | 2 |
| C3 | [HEL-568 — "Agent standup" digest](https://linear.app/helloautoflow/issue/HEL-568) | dev-app · interactive, Feature | Medium | 5 |

### Intentionally NOT filed (already covered by existing projects)

| Rec | Already tracked by |
|---|---|
| B1 — distributed coordinator locks | Durable-state audit (+ Infra: Durable Objects "leader-election locks") |
| D3 — Ask-CEO / approvals inbox | Governance consolidation *(note: that project plans to retire escalations — my "surface it" recommendation conflicts; reconcile there)* |
| U1 / U2 / U3 — empty states, dead controls, onboarding tour | Functionality Audit — real-vs-hardcoded remediation |
| B2 (hiring-plan path) — team-assembly token cap | Chunked team-assembly generation |
| B3 — DAG-run worker stub | P3 — Durable execution (validation caveat §4) |
| D4 / enterprise (audit-UI, SSO, SOC2) | P6 — Enterprise readiness (Later) |

---

*Method limitation (also flagged in the header): this pass reasoned from code + the v2 prototypes, not a live authenticated dashboard session. A live walkthrough with screenshots is the recommended next step to verify findings firsthand.*

*Next: tell me which recommendation you want me to spec in detail or start building first.*
