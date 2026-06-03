# Completed-projects validation — 2026-06-03

**Scope:** Every Linear project in the Helloautoflow team currently marked
**Completed** was validated against the actual state of this repository
(branch `claude/validate-completed-projects-feBND`). Verification was done by
**reading the real source/config files** behind each claim — not by grep/regex
pattern matching — and reconciling them against each project's description,
issues, and stated definition of done.

Each project was audited by an independent agent that (1) pulled the project +
its issues from Linear, (2) built a checklist of concrete, code-verifiable
deliverables, and (3) opened the relevant files to confirm whether the code
genuinely fulfils the claim.

## Verdict legend

- **VERIFIED** — all code-verifiable deliverables are present and genuinely implemented.
- **PARTIALLY VERIFIED** — substantial work landed, but at least one claimed/accepted deliverable is missing, stubbed, or diverges from spec.
- **NOT VERIFIED** — the "Completed" status is not backed by the codebase.
- **N/A** — nothing code-verifiable (test/stray project).

## Summary

| Project | Verdict | Headline finding |
|---|---|---|
| DB-driven pricing tiers & dashboard upgrade nudges | **VERIFIED** | All 6 issues' deliverables present; the three diverging pricing copies were genuinely consolidated to a DB-backed source + public endpoint. |
| Dashboard v2 consolidation | **VERIFIED** | 3-pillar IA, inline row drawer, merged Approvals/Activity, scope-aware Connections/Memory/EnvVars, actionable Pro Mode all real (not mockups). Minor: Activity tab in Assignments is scaffolded, not wired. |
| P0 — Foundations | **VERIFIED** | All 36 issues backed by code (glossary, README/CLAUDE rewrite, Azure removal, Postgres-mandatory guard, Infisical). Only the *live* GitHub branch-protection state is not code-verifiable (machinery present). |
| P2.5 — Backend consolidation (TS Express on Fly) | **VERIFIED (substantially)** | FastAPI relay fully removed; 3 TS Express Fly apps; three-layer memory + tier routing + wake-ups all present. Gap: HEL-92's `InstructionsEditor.tsx` was folded into `Memory.tsx` instead; one stale comment. |
| P3 — Durable execution | **VERIFIED (with caveats)** | BullMQ/Redis queue, worker, retries, idempotency, DLQ, scheduling, replay all present. Caveats: **DAG-run worker handler is a stub** (DAG steps still fall back to in-process); legacy in-process + old Upstash-REST queue paths not deleted. |
| Sentry observability hardening | **PARTIALLY VERIFIED** | CI release/deploy tracking (HEL-345/346), cron monitor (HEL-347) genuinely wired. Alerts/uptime/dashboard are documented runbooks (UI-applied, not code) — honest, but unverifiable. Docs split across 2 files vs the single `sentry.md` the issue specified. |
| SMB Dashboard Overhaul | **PARTIALLY VERIFIED** | All 17 DASH items (incl. the DASH-1 deploy-mission root-cause fix) genuinely landed. Minor: OnboardingTour step 3 anchors a stale route (`/integrations/mcp` vs `/connections`) so it silently skips; Settings copy-polish not statically confirmable. |
| P2 — First customer loop | **PARTIALLY VERIFIED** | Whole loop is functionally implemented end-to-end. But the project's own DoD ("golden-path E2E green in CI") is **unmet**: 11 `test.fixme` guards still live; HEL-161 ("unblock E2E phases 6–13") was marked Done without removing them; HEL-26 org chart is a card-list, not the graph its E2E test asserts. |
| P7 — Sales + marketing motion | **PARTIALLY VERIFIED** | Tier names + prices align (landing fallback ↔ backend). But **pricing drift**: `dashboard/src/pages/Pricing.tsx` advertises "Unlimited" executions/connections that `src/billing/entitlements.ts` hard-caps. No demo embed; `landing/components/sections/Pricing.tsx` (cited in scope) doesn't exist; no case-studies pages. |
| P6 — Enterprise readiness | **NOT VERIFIED** | Only **1 of 5** described deliverables was ever ticketed (HEL-192), and that issue shipped neither its headline `/api/audit-log` endpoint nor any audit UI. SAML SSO, SOC2/Vanta, InfoSec pack, MSA/DPA are entirely absent. |
| Above The Wild | **N/A** | Stray test project — single "Test Issues"/"Testing" item. Nothing to validate. |

---

## Most material discrepancies (Completed status not backed by code)

### 1. P6 — Enterprise readiness → **NOT VERIFIED** (most severe)
- The project describes five deliverables: SOC 2 (Vanta/Drata), SAML SSO (WorkOS/BoxyHQ), an audit-log UI surface, an InfoSec questionnaire pack, and MSA/DPA templates.
- Only **HEL-192** was filed; the other four were never tracked and have **no code**.
- HEL-192's title leads with `/api/audit-log` — that endpoint **does not exist** in `src/app.ts`. The linked PR delivered only a couple of CRUD `PATCH` routes. The issue went `In Progress → Done` in ~4 seconds.
- What *does* exist: the `audit_log` table (`schema.sql`, from migration 020, renamed in 021) and the write service `src/auditing/auditService.ts`. The read API, dashboard page, and CSV export do not.
- **Recommendation:** reopen the project (or move back to Backlog) and file the four missing deliverables as sub-issues; at minimum re-open HEL-192 since its primary deliverable is missing.

### 2. P2 — First customer loop → **PARTIALLY VERIFIED** (DoD unmet)
- The loop works in code, but the stated definition of done — "golden-path e2e green in CI" — is not met. `dashboard/e2e/golden-path.spec.ts` has **11 active `test.fixme` blocks** (phases 5–14).
- **HEL-161** ("Unblock golden-path E2E phases 6–13") was marked Done without ever entering `In Progress` and without removing a single `test.fixme`. Its own acceptance criteria are unmet.
- **HEL-26** (org chart) is marked Done but is a collapsible card-list, not the visual graph its E2E test (`data-testid="org-chart-node"`) asserts; the Phase-8 fixme was never removed.
- **Recommendation:** re-open HEL-161 and HEL-26; their acceptance criteria are demonstrably unmet.

### 3. P7 — Pricing drift across surfaces (correctness risk)
- `dashboard/src/pages/Pricing.tsx` advertises "Unlimited workflow executions" / "Unlimited LLM provider connections" on tiers that `src/billing/entitlements.ts` hard-caps (`runsPerMonth`, `integrationCap`). The in-app pricing surface contradicts the gate that actually enforces limits — a user-facing accuracy problem.
- The file cited in the project scope, `landing/components/sections/Pricing.tsx`, doesn't exist (pricing is inline in `landing/app/page.tsx`); no Loom/Storylane demo embed; no case-studies pages.
- **Recommendation:** file a `bug` ticket to reconcile dashboard pricing copy with entitlements (the DB-driven pricing project already established the source of truth — the dashboard page should read from it).

### 4. P3 — DAG-run worker handler is a stub (latent gap)
- The durable queue/worker is real, but `src/worker.ts`'s `handleRunsJob()` only logs for workflow **DAG** runs ("stub until HEL-107+"); DAG execution still falls back to the in-process `WorkflowEngine`. Agent-prompt runs (the primary path) are fully queue-backed.
- Legacy in-process fallback in `src/app.ts` and the old Upstash-REST queue `src/engine/queue.ts` were not deleted.
- **Recommendation:** confirm whether DAG runs are expected to be queue-backed; if so, this is unfinished durable-execution scope. Otherwise, document the boundary and delete dead code.

---

## Minor / cosmetic discrepancies (do not undermine Completed status)

- **Sentry:** docs delivered as `sentry-alerts-and-dashboards.md` + `sentry-monitors.md` rather than the single `docs/observability/sentry.md` the issue named. Alerts/uptime/dashboard are UI-applied (correctly documented as runbooks). Vercel-integration retirement is a UI action, not code.
- **SMB Dashboard:** `OnboardingTour.tsx` step 3 selector `nav a[href="/integrations/mcp"]` no longer matches the nav (`/connections`), so that step silently no-ops.
- **P2.5:** HEL-92's dedicated `InstructionsEditor.tsx` was implemented inline in `Memory.tsx`; stale "stays running until HEL-97" comment in `dashboard/src/api/baseUrl.ts`.
- **Dashboard v2:** the Activity tab panel in `Assignments.tsx` is scaffolded (imports `useObservabilityQuery` but renders a fallback) rather than fully wired.
- **P0:** README still lists "Azure" as a BYOK *LLM provider* option — distinct from the Azure-*infra* removal that was in scope, so not a discrepancy, just worth noting.

---

## Method note

Per the request, no claim was confirmed via grep/regex matching: each deliverable
was checked by opening the actual implementation/config file and reasoning about
whether it fulfils the claim. Directory listing/file-existence checks were used
only to locate files; the determination always came from reading file contents.
GitHub-settings-level items (branch protection) and external-platform items
(Infisical secrets, Sentry UI config, Vanta) are inherently not code-verifiable
and are flagged as such rather than counted against a project.
