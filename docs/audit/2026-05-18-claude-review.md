# Frontend / Backend / Database Review — Claude pass

Date: 2026-05-18
Reviewer: Claude (Opus 4.7, 1M context)
Scope: Find disconnects across `dashboard/src`, `src/`, and `migrations/`. Fixes deferred — this is the inventory pass to compare against Codex's independent review.

## How to read

Findings are grouped by severity. Each one has a one-line root cause and a file:line pointer. No fixes here — those land as PRs after the user reviews both audits side by side.

---

## CRITICAL — blocks customer flow

### C1. ProfileSettings calls `/api/user/profile` but `profileRoutes` is never mounted

- Backend exists: [src/user/profileRoutes.ts:25,68,69](src/user/profileRoutes.ts) defines `GET /profile`, `PATCH /profile`, `PUT /profile`. Only the test file [src/user/profileRoutes.test.ts:21](src/user/profileRoutes.test.ts) mounts it.
- `src/app.ts` has zero references to `profileRoutes`.
- Result: every PATCH from [dashboard/src/pages/ProfileSettings.tsx:99-114](dashboard/src/pages/ProfileSettings.tsx) 404s, the page silently falls back to sessionStorage, and the toast message "Profile saved locally while the backend endpoint is pending" misleads the user into thinking this is intentional.
- Fix shape: one line in `src/app.ts` — `app.use("/api/user", requireAuth, profileRoutes);` (mirrors the workspace mount pattern).

### C2. HITL / Approvals is in-memory only — every Fly restart wipes all approvals

- [src/hitl/hitlStore.ts:168-172](src/hitl/hitlStore.ts) declares five `Map<>` stores: schedules, checkpoints, artifactComments, askCeoRequests, notifications.
- [src/hitl/hitlRoutes.ts](src/hitl/hitlRoutes.ts) is the only consumer; never touches Postgres.
- Meanwhile `migrations/024_hitl_activity_events.sql` created the canonical `approvals` table. **No application code reads or writes it** — the only `FROM approvals` references are in `src/db/rls.integration.test.ts`.
- Same shape of bug as DASH-36: a canonical schema exists but the runtime stores never migrated onto it. Restart → checkpoints, schedules, all askCEO requests, and notifications vanish.

### C3. `Ask the CEO` flow is half-built and unreachable

- Backend: [src/hitl/hitlRoutes.ts:308-316](src/hitl/hitlRoutes.ts) has `POST /api/hitl/companies/:companyId/ask-ceo/requests` fully wired with a schema.
- Dashboard client: [dashboard/src/api/client.ts:1824-1831](dashboard/src/api/client.ts) defines the `createAskCeoRequest` helper.
- **No page or component imports it.** The Ask-CEO escalation path that the engine emits is never surfaced. If an agent escalates to CEO, the request lands in the in-memory map and the user never sees it.

### C4. BullMQ worker process never ran in dev because Upstash secrets weren't bridged

- Already covered in flight by DASH-37 (#871) + DASH-38 (#873), but flagging here for the audit: the worker pool in `fly.api.dev.toml` is `stopped` because `worker.ts` exits when `REDIS_URL` / `UPSTASH_REDIS_URL` aren't on the machine. Until those merge + Upstash is verified, `/api/wake-events`, agent presence, and scheduled routines do not function in prod.

---

## HIGH — orphan backend (working API with no UI)

### H1. `/api/reporting` — full CRUD, zero dashboard consumers

- [src/reporting/reportRoutes.ts:51,64,79](src/reporting/reportRoutes.ts) defines `GET /`, `GET /:id`, `POST /generate`.
- `grep -r '/api/reporting' dashboard/src` returns zero results.
- Either kill the routes or build the Reports page. Hard to tell which without a product decision.

### H2. `/api/admin/curated-knowledge` — full CRUD, zero consumers

- [src/admin/curatedKnowledgeRoutes.ts:72,90,108,145,191](src/admin/curatedKnowledgeRoutes.ts) — GET list, GET one, POST, PATCH, DELETE.
- This is the staff-admin layer for HEL-93 "curated global knowledge." No `/admin` page exists in the dashboard yet (router has no `/admin/*` route).
- The plan calls for a staff Admin surface in P5. Worth filing.

### H3. `/api/knowledge/reflect` — HEL-91 manual reflection has no trigger

- [src/knowledge/reflectionRoutes.ts:40](src/knowledge/reflectionRoutes.ts) — `POST /` runs episode clustering + graduates synthesized knowledge.
- Zero dashboard consumers. WorkspaceMemory page has no "Run reflection" button.

### H4. `/api/step-results/:runId` — never read by the dashboard

- [src/canonical/canonicalReadRoutes.ts:174](src/canonical/canonicalReadRoutes.ts) returns step-by-step output for a run.
- No Run Detail page in the dashboard surfaces this. Workflow runs are opaque to users — they can see a run in Activity feed but not drill into per-step output, cost, or duration.

### H5. `/api/ticket-sync` — webhook + REST, no UI

- Mounted at `src/app.ts:776` and `src/app.ts:464` (webhook receiver).
- No dashboard consumer for status / config / forced-resync of the ticket sync integration.

### H6. `/api/companies` — only test files reference it

- [src/companies/companyRoutes.ts:71,80](src/companies/companyRoutes.ts) — `GET /role-templates` + `POST /` (provision).
- Dashboard's `client.test.ts` has tests but **no page calls these**. The provisioning path was replaced by hiring-plan confirm; the legacy route stays mounted but does nothing useful.

### H7. `/api/agents/priority-classify` — helper exists, no caller

- Helper at [dashboard/src/api/agentActionsApi.ts:97](dashboard/src/api/agentActionsApi.ts) calls `POST /api/agents/priority-classify`.
- Backend: [src/agents/agentActionsRoutes.ts:317](src/agents/agentActionsRoutes.ts).
- **No component or page imports `classifyPriority`** (unlike `checkInAgent` + `handoffToAgent` which are wired into AgentCardActions / HandoffModal). Dead-end UX feature.

---

## MEDIUM — UI exists but admits it's unwired

### M1. `ApiKeys` page is a coming-soon placeholder

- [dashboard/src/pages/ApiKeys.tsx:19-30](dashboard/src/pages/ApiKeys.tsx) renders "Coming soon — API key lifecycle is not enabled yet." No backend exists for it. Either build the lifecycle (key issue / rotate / revoke endpoints), unlink the route, or hide it from the nav.

### M2. `SecuritySettings` password-change UI is decorative

- [dashboard/src/pages/SecuritySettings.tsx:67](dashboard/src/pages/SecuritySettings.tsx) — "Password management is not connected to a backend endpoint in this environment yet." The form is rendered with input fields; submitting goes nowhere. Either wire to Supabase Auth's password-update API or remove the form.

### M3. Settings → bulk-pause-agents button is a tooltip-only stub

- [dashboard/src/pages/Settings.tsx:717](dashboard/src/pages/Settings.tsx) — "Coming soon — pause individual agents from the Team page in the meantime." Either build the bulk pause backend or remove the affordance.

### M4. ProfileSettings sessionStorage fallback is misleading

- Independent of C1, even when 404 isn't caused by an unmounted route, falling back to sessionStorage and telling the user "saved locally while the backend endpoint is pending" is fragile UX. Logs out → data lost. Should be a hard error.

---

## LOW — schema orphans (canonical tables nothing references)

### L1. `agent_assignments` (migration `031_agent_assignments_org_edges.sql`)

- Zero `FROM agent_assignments` / `INTO agent_assignments` references in `src/` (only the org_edges sibling is used).
- Either populate the table from the hiring-plan confirm path or drop it from the schema.

### L2. `agent_memory_sharing_policies`, `agent_memory_workspace_shares`

- Created in `migrations/016_agent_memory_workspace_isolation.sql` but never read or written by `src/`. Three-layer memory (HEL-86, migration 034) effectively replaced them.

### L3. Legacy outreach tables: `icp_profiles`, `email_sends`, `campaigns`

- From pre-canonical era. No current code touches them.
- Candidate for a "drop legacy outreach schema" PR once we confirm no migration data needs to be preserved.

### L4. `memory_entries` (migration `002_workflow_runtime_persistence.sql`)

- The original generic memory table. Only the retention sweep ([src/db/runtimeRetention.ts:41](src/db/runtimeRetention.ts)) ever touches it. Three-layer memory (HEL-86) is the live path. Same fate as L3 — drop or rebrand.

---

## Observations on architecture (not findings, just patterns)

- **Two storage philosophies coexist.** The plan's canonical-noun model (workspaces / companies / missions / agents / runs / step_results / approvals / tickets) is partially live: missions, hiring_plans, workflows, runs, step_results, activity_events, budgets, entitlements, wake_events, connector_connections **do read/write Postgres** via `withWorkspaceContext`. Approvals, HITL checkpoints, ask-CEO, and the legacy controlPlaneStore (teams, agents, heartbeats, tasks, executions, spend) **stay in-memory**. The DASH-27 + DASH-40 fixes are starting to glue these together by reading from both stores in route handlers. Worth deciding which way to migrate fully.
- **Worker process is dev-only in the fly toml.** `fly.api.staging.toml` and `fly.api.production.toml` have no `[processes]` block at all — only `app` runs in higher envs. Once Upstash is in staging/prod Infisical, those configs need the worker block (DASH-37 PR body flags this).
- **The dashboard `controlPlaneStore` integration is the legacy spine.** Any new feature that reads from it instead of Postgres will re-introduce the DASH-27/DASH-40 class of bug after every restart.

## What's NOT in this audit

- Per-line code review (security, type safety, race conditions). Out of scope — would need a dedicated security pass per file.
- Visual / UX consistency review. DASH-35 + DASH-38 covered the V2 design sweep.
- Migration backfill scripts. Where canonical tables exist but in-memory state holds the live data (HITL, controlPlaneStore), a backfill pass would need to be designed before cutover.
