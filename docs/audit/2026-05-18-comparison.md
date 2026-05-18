# Audit comparison — Claude (HEL-139) vs Codex (HEL-140)

Date: 2026-05-18
Source files: `2026-05-18-claude-review.md` + `2026-05-18-codex-review.md`

## TL;DR

Strong cross-coverage. **Combined unique valid findings: ~19.**

- Both caught: ProfileSettings unmounted, ApiKeys + SecuritySettings placeholders, several orphan backends, legacy schema orphans.
- **Claude caught and Codex missed:** HITL fully in-memory; Ask-CEO unreachable; orphan backends `/api/admin/curated-knowledge`, `/api/knowledge/reflect`, `/api/step-results`, `/api/companies`; orphan schemas `agent_assignments`, `agent_memory_sharing_*`.
- **Codex caught and Claude missed:** LandingPage waitlist path mismatch; Memory page actively reads in-memory store; `approval_notifications` write-Postgres / read-memory dual-store asymmetry; orphan backends `/api/knowledge`, `/api/approval-policies`; `llm_configs` migration orphan (specific cause); dead helpers in `dashboard/src/api/controlPlane.ts` + Proposal Builder + agent/routine create helpers.
- **Codex false positives (do not act on):** 4 findings citing files/contracts that don't exist or are stale (details below).

---

## Merged finding list, ordered by what I'd fix first

### TIER 1 — silent customer-facing breakage (fix this week)

| # | Finding | Source | Pointer |
| --- | --- | --- | --- |
| 1 | `ProfileSettings` calls `/api/user/profile`; `profileRoutes` is never mounted in `src/app.ts`. PATCH 404s; page silently saves to sessionStorage with a misleading "backend endpoint pending" toast. | both | [src/user/profileRoutes.ts:25](src/user/profileRoutes.ts) · [src/app.ts](src/app.ts) · [dashboard/src/pages/ProfileSettings.tsx:99-114](dashboard/src/pages/ProfileSettings.tsx) |
| 2 | LandingPage waitlist POSTs to `/api/waitlist-signup` but backend mounts at `/api/public/landing/waitlist-signup`. Every signup 404s. | Codex | [dashboard/src/pages/LandingPage.tsx:132](dashboard/src/pages/LandingPage.tsx) · [src/landing/publicApiRoutes.ts:201](src/landing/publicApiRoutes.ts) |
| 3 | `approval_notifications.list()` reads only the in-memory `Map`, but `persistNotification()` writes to Postgres when available. The global `/api/approvals/notifications` and the notification coordinator both call `list()`, so persisted notifications are invisible to the dashboard. | Codex | [src/engine/approvalNotificationStore.ts:58,142](src/engine/approvalNotificationStore.ts) |
| 4 | `/api/memory` (workspace Memory page) is fully in-memory via `src/engine/memoryStore.ts`. Canonical `memory_entries` table (migration 002) exists but `memoryRoutes` never touches it. Every Fly restart wipes user-added memory. | Codex | [src/memory/memoryRoutes.ts:61](src/memory/memoryRoutes.ts) · [src/engine/memoryStore.ts:61](src/engine/memoryStore.ts) |
| 5 | HITL / Approvals is fully in-memory. Five `Map<>` stores in `hitlStore.ts:168-172`. Canonical `approvals` table (migration 024) exists, unused. Every restart wipes checkpoints + schedules + ask-CEO requests + artifact comments + notifications. | Claude | [src/hitl/hitlStore.ts:168-172](src/hitl/hitlStore.ts) |
| 6 | Ask-the-CEO escalation backend mounted (`POST /api/hitl/companies/:companyId/ask-ceo/requests`), `createAskCeoRequest` helper exists in `client.ts:1824`, but no component imports it. Escalations land in the in-memory map and the user never sees them. | Claude | [src/hitl/hitlRoutes.ts:308](src/hitl/hitlRoutes.ts) · [dashboard/src/api/client.ts:1824](dashboard/src/api/client.ts) |

### TIER 2 — orphan backends / dead UI (cleanup or build)

| # | Finding | Source | Pointer |
| --- | --- | --- | --- |
| 7 | `ApiKeys` page is a "Coming soon" placeholder; no backend. | both | [dashboard/src/pages/ApiKeys.tsx:19-30](dashboard/src/pages/ApiKeys.tsx) |
| 8 | `SecuritySettings` password-change form admits it's not wired. Either bind to Supabase Auth's password endpoint or hide the form. | both | [dashboard/src/pages/SecuritySettings.tsx:67](dashboard/src/pages/SecuritySettings.tsx) |
| 9 | `Settings.tsx:717` bulk-pause-agents button is a tooltip-only stub. | Claude | [dashboard/src/pages/Settings.tsx:717](dashboard/src/pages/Settings.tsx) |
| 10 | Orphan backends with zero dashboard consumers: `/api/reporting`, `/api/admin/curated-knowledge`, `/api/knowledge/reflect`, `/api/step-results`, `/api/ticket-sync`, `/api/companies`, `/api/knowledge`, `/api/approval-policies`. Decide for each: build UI or unmount. | combined | various |
| 11 | Dead helpers in `dashboard/src/api`: `controlPlane.ts` duplicates of helpers in `client.ts`; Proposal Builder helpers with no page or backend; `agentApi.ts` create-agent + create-routine helpers nobody calls; `classifyPriority` from `agentActionsApi.ts:97`; `debugStep` from `client.ts:1109`. | combined | various |

### TIER 3 — schema and data hygiene (low priority but worth a sweep)

| # | Finding | Source | Pointer |
| --- | --- | --- | --- |
| 12 | `llm_configs` table is orphan — LLM config storage moved to `CentralCredentialStore` via `connector_credentials`. | Codex | [migrations/005_llm_configs.sql:3](migrations/005_llm_configs.sql) |
| 13 | `agent_assignments` table created (migration 031) — zero `FROM`/`INTO` references. | Claude | [migrations/031_agent_assignments_org_edges.sql](migrations/031_agent_assignments_org_edges.sql) |
| 14 | `agent_memory_sharing_policies`, `agent_memory_workspace_shares` orphan after three-layer memory (HEL-86). | Claude | [migrations/016_agent_memory_workspace_isolation.sql](migrations/016_agent_memory_workspace_isolation.sql) |
| 15 | Legacy outreach tables: `icp_profiles`, `email_sends`, `campaigns` — pre-canonical, zero refs. | combined | [migrations/001_autoflow_schema.sql](migrations/001_autoflow_schema.sql) |
| 16 | `memory_entries` (migration 002) — only the retention sweep touches it; live memory path moved to three-layer (HEL-86). | both | [migrations/002_workflow_runtime_persistence.sql](migrations/002_workflow_runtime_persistence.sql) |
| 17 | `ProfileSettings` sessionStorage fallback is fragile UX even when the backend is mounted — logging out wipes "saved" data. Make it a hard error. | Claude | [dashboard/src/pages/ProfileSettings.tsx:106-115](dashboard/src/pages/ProfileSettings.tsx) |

### TIER 4 — architectural pattern (decide direction)

| # | Observation | Source | Notes |
| --- | --- | --- | --- |
| 18 | **Two storage philosophies coexist.** Canonical Postgres is live for missions/runs/budgets/etc. In-memory still runs HITL + the legacy `controlPlaneStore` (teams/agents/heartbeats/tasks/spend). DASH-27 + DASH-40 are gluing them piecemeal. Worth deciding which way to migrate fully before more route handlers get the dual-store pattern. | Claude | architecture |
| 19 | Worker process is dev-only in fly toml — staging/prod toml have no `[processes]` block. Flagged in DASH-37 PR body; needs a follow-up once Upstash is in staging/prod Infisical. | Claude | DASH-37 |

---

## Codex false positives (ignore)

These all looked like bugs in Codex's report but verification showed otherwise:

1. **MissionState calls `/api/control-plane/teams/:id/mission-state`** — that text is in a JSDoc on `MissionState.tsx:18` explaining the *removed* old contract. Current code uses `listMissions()`.
2. **RunMonitor "Debug with AI" posts to `/api/debug/step`** — `dashboard/src/pages/RunMonitor.tsx` does not exist. The `debugStep` helper in `client.ts:1109` does exist, but it's a dead helper (no caller) — same class as `classifyPriority`, captured in Tier 2 #11.
3. **`workflow_approval_requests` typo in `runtimeRetention.ts`** — current code at line 31 correctly says `DELETE FROM approval_requests`. Codex may have been reading a stale snapshot.
4. **`Routines` page wired to stubbed `GET /api/routines`** — `dashboard/src/pages/Routines.tsx` does not exist. `routineRoutes` is fully mounted with GET + PATCH at `src/app.ts:645`, consumed by `AgentDetail` via `routinesApi.ts`.

These represent ~25% of Codex's findings being noise. Worth knowing for any future repeat-pass.

---

## Recommended PR sequencing

If you authorize the work, I'd ship in this order to maximize visible impact per PR:

1. **DASH-41** Mount `profileRoutes` in `src/app.ts` + remove sessionStorage fallback message (Tier 1 #1, partial #17).
2. **DASH-42** Fix LandingPage waitlist path (Tier 1 #2). One-liner.
3. **DASH-43** `approval_notifications.list()` reads Postgres when available (Tier 1 #3). Mirrors DASH-27/-40 dual-store fix.
4. **DASH-44** Migrate `/api/memory` to canonical `memory_entries` table — biggest data-loss surface (Tier 1 #4).
5. **DASH-45** Migrate `/api/hitl` off in-memory `Map<>` stores onto canonical `approvals` + add backfill (Tier 1 #5). Largest scope; may want a design pass first.
6. **DASH-46** Surface Ask-the-CEO requests in the dashboard (Tier 1 #6) — wire the existing helper into Approvals or a dedicated escalation panel.
7. **Cluster cleanup PR** DASH-47..50 Tier 2 + Tier 3 — orphan-route decisions, dead helper purges, legacy schema drops. Multiple smaller PRs is fine.

Tier 4 architectural decision (canonical vs in-memory) is worth a separate planning session rather than a PR.

---

## Pointers

- Claude's full report: `docs/audit/2026-05-18-claude-review.md` (PR #876)
- Codex's full report: `docs/audit/2026-05-18-codex-review.md` (PR #878)
- This comparison: `docs/audit/2026-05-18-comparison.md`
- Linear tickets: [HEL-139](https://linear.app/helloautoflow/issue/HEL-139) (Claude), [HEL-140](https://linear.app/helloautoflow/issue/HEL-140) (Codex)
