# MVP loop & codebase audit (2026-05-19)

> **Status:** Review only — no implementation in scope for this document.  
> **Audience:** Brad / Helloautoflow team  
> **Method:** Four parallel codebase audits (backend routes, dashboard mocks/responsiveness, v2 design alignment, MVP loop completeness).  
> **Suggested Linear:** Create parent issue **“MVP loop audit — findings & remediation backlog”** in P2 — First customer loop (or P5 — Customer readiness); link sub-issues from sections marked **Ticket candidate**.

---

## Summary

AutoFlow has **late-stage breadth** (60+ DB tables, ~90 dashboard routes, mission → hiring plan → confirm agents largely wired) but the **first-paying-customer golden path is not closed**. A paying SMB can sign up, describe a mission, review a plan, and provision agents — but cannot reliably complete **deploy routine → scheduled re-runs → attributable activity + cost** without manual Studio work and BYOK setup first.

| Area | Verdict |
|------|---------|
| Mission + hiring plan | Strong |
| Deploy routine + scheduled re-runs | **Broken** (no `POST /api/routines`) |
| Activity + cost | **Partial** (wrong feed; many `—` placeholders) |
| v2 design (Run / Workforce pages) | ~70% aligned |
| Responsive UI | Desktop-first (`af2-components.css` has no `@media`) |
| Mock / shell UI | Dev mocks off in prod; production placeholders remain |

### MVP loop scorecard

```
Sign up              ████████░░  80%
Workspace + company  ██████░░░░  60%
Mission              ████████░░  80%  (LLM ordering wrong for free tier)
Hiring plan          ███████░░░  70%  (BYOK required today)
Confirm agents       ███████░░░  75%  (no routines; no agentCap gate)
Connect tools        ██████░░░░  60%
LLM / hosted         █████░░░░░  50%
Deploy routine       ███░░░░░░░  30%  ← primary gap
First run            ████░░░░░░  40%
Approval / ticket    ███████░░░  70%
Activity + cost      ████░░░░░░  40%
```

### Recommended implementation order (when approved)

1. **P0** — `POST /api/routines` + confirm seed or post-confirm CTA; fix Settings profile path  
2. **P1** — Activity → `/api/activity-events`; reflection LLM deps; Settings billing + company lifecycle; entitlement on confirm  
3. **P1** — `af2-*` responsive CSS (stats, lists, page-head)  
4. **P2** — Remove proposal 404 mocks; delete/wire dead marketplace; Studio v2 colors; unblock golden-path E2E; Azure artifact cleanup  

---

## P0 — MVP loop blockers

### P0-1: No routine creation API (deploy + schedule) — **Ticket candidate**

**Problem:** Backend `src/routines/routineRoutes.ts` exposes only `GET /` and `PATCH /:id`. Dashboard `dashboard/src/api/agentApi.ts` calls `POST /api/routines` via `createRoutine()` — **404**.

**Impact:** MVP steps “deploy a routine” and “scheduled re-runs work reliably” cannot complete. Hiring-plan confirm (`POST /api/hiring-plans/:id/confirm`) provisions agents/org edges but does **not** insert `routines` or register BullMQ scheduler jobs. `AgentStandingTasks.tsx` only toggles **existing** routines.

**Evidence:**

- `src/routines/routineRoutes.ts` — lines 65–98 (GET + PATCH only)
- `dashboard/src/api/agentApi.ts` — `createRoutine()` POST
- `src/missions/hiringPlanRoutes.ts` — confirm transaction (agents only)

**Proposed fix (when actioned):**

- Add `POST /api/routines` with `workspace_id`, `agent_id`, `workflow_id`, `schedule_cron`, `trigger_kind`, `enabled`
- Sync BullMQ on create (mirror PATCH scheduler path)
- Optionally seed default routine on hiring confirm OR add CTA on `HiringPlanReview.tsx` → standing tasks / Studio

**Acceptance criteria:**

- [ ] `POST /api/routines` returns 201 with persisted row
- [ ] Enabling routine schedules via existing PATCH + worker path
- [ ] E2E golden-path Phase 9+ can create routine without manual SQL

---

### P0-2: Settings profile API path mismatch — **Ticket candidate**

**Problem:** `dashboard/src/pages/Settings.tsx` loads/patches `/api/profile`. Backend profile routes live at `/api/user/profile` (`src/user/profileRoutes.ts`). `ProfileSettings` may use the correct path; **General tab profile save 404s**.

**Evidence:**

- `dashboard/src/pages/Settings.tsx` — ~lines 392, 412 (`/api/profile`)
- `src/user/profileRoutes.ts` — `/api/user/profile`

**Proposed fix:** Change Settings General tab to `/api/user/profile` (align with `ProfileSettings`).

**Acceptance criteria:**

- [ ] Save display name + timezone from Settings General tab persists
- [ ] No 404 on profile load/save in Network tab

---

### P0-3: Knowledge reflection endpoint is a no-op — **Ticket candidate**

**Problem:** `POST /api/knowledge/reflect` mounted in `src/app.ts` with stub deps (`NULL_REFLECT`, `STUB_EMBED` in `src/knowledge/reflectionRoutes.ts`). Workspace Memory “Run consolidation” completes but does not synthesize knowledge.

**Proposed fix:** Inject real `llmReflect` + `embedFn` when wiring `createReflectionRoutes(getPostgresPool(), { ... })`.

**Acceptance criteria:**

- [ ] Reflection run creates/updates `knowledge_items` with non-empty embeddings
- [ ] Integration test or manual verify on `WorkspaceMemory.tsx`

---

## API gaps (dashboard ↔ backend)

### Missing or mismatched

| Priority | Issue | Dashboard | Backend |
|----------|--------|-----------|---------|
| **P0** | Create routine | `POST /api/routines` (`agentApi.ts`) | Missing |
| **P0** | Profile | `/api/profile` (`Settings.tsx`) | `/api/user/profile` |
| P1 | Create agent | `POST /api/agents` (`agentApi.ts`) | Read-only `agentRoutes.ts` |
| P1 | Subscription mgmt | None in Settings | `GET/POST /api/billing/subscription/*` exists |
| P1 | Pause all agents | Settings disabled | `POST /api/control-plane/company/lifecycle` exists |
| P2 | Proposals / debug | `client.ts` → `/api/proposals/*`, `/api/debug/step` | No routes; 404 → **client mock CRM** |
| P2 | Approval `request_changes` | `resolveApproval` only approved/rejected | Backend supports more |
| P2 | Knowledge create | `memoryApi.ts` gap | `POST /api/knowledge-items` exists |

### Backend ready, UI not wired (orphans)

- `GET /api/billing/subscription`, change-tier, cancel, reactivate
- `GET/POST /api/control-plane/company/lifecycle`
- `GET /api/approvals/notifications`
- `DELETE /api/runs/:id/cancel`, replay-with-latest, `POST /api/executions/:id/resume`
- `GET /api/step-results/:runId` (dashboard uses embedded run payload)
- Canonical `GET /api/activity-events` — `dashboard/src/api/activityApi.ts` exists but **unused**

### Activity feed handoff bug — **Ticket candidate (P1)**

- **Client:** `dashboard/src/api/activityApi.ts` — `listActivityEvents()` → `/api/activity-events`
- **Page:** `dashboard/src/pages/AgentActivity.tsx` uses `listObservabilityEvents()` (legacy stream)
- **Fix:** Wire Activity page to canonical feed; ensure run lifecycle emits `activity_events`

---

## Mock, fake, and shell UI (production-visible)

### Honest placeholders (`—`)

| Page | Stub |
|------|------|
| `Dashboard.tsx` | Hours saved, approval p50 (“lands with HEL-118”) |
| `Approvals.tsx` | Cost column, median wait; risk from timeout heuristic |
| `MissionState.tsx` | Progress % from status heuristic |
| `BudgetDashboard.tsx` | Cost per hour saved, “By model” card |
| `Hire.tsx` | Readiness pill (client-only) |

### Non-functional controls

| Control | File |
|---------|------|
| Export CSV / Filter | `AgentActivity.tsx` (HEL-60) |
| Budget row Edit | `BudgetDashboard.tsx` |
| Org map / List view | `OrgStructure.tsx` (disabled) |
| Routing rules | `LLMProviders.tsx` (no handler) |
| Pause all agents | `Settings.tsx` |
| Billing tab | `Settings.tsx` (empty shell) |
| Templates Mine / Shared | `Templates.tsx` (always empty) |

### Dead or misleading surfaces — **Ticket candidate (P2 cleanup)**

| Item | Notes |
|------|--------|
| `IntegrationMarketplace.tsx` | 160+ hardcoded integrations; **not in `router.tsx`** |
| `ApiKeys.tsx` | Full “coming soon” shell |
| `client.ts` proposal fallbacks | Synthetic CRM on 404 for WorkflowBuilder |
| `VITE_USE_MOCK=true` | Dev-only; `dashboard/.env.production` sets false |

---

## v2 design language compliance

### Done well

- HEL-30 token lift: `dashboard/src/af2-tokens.css`, `af2-components.css`, Tailwind `af2-*`
- Core pages align with `docs/design/v2/pages.jsx`: Home, Missions, Approvals, Activity, Team, Hire, Budget, Library, Settings

### Gaps — **Ticket candidates (HEL-32 follow-on)**

| Gap | Files |
|-----|--------|
| Body font Inter-first vs Geist + Fraunces | `dashboard/src/index.css`, `tailwind.config.js` |
| No shared React primitives (`Af2Button`, `Af2Page`) | Repo-wide drift |
| WorkflowBuilder Electric Lab hex on nodes | `WorkflowBuilder.tsx` `STEP_KIND_META` |
| Landing dark violet/cyan marketing | `LandingPage.tsx` vs `docs/design/v2/AutoFlow Landing.html` |
| Prototype modals not shipped | `docs/design/v2/modals.jsx` |
| Sidebar budget ring missing | `Layout.tsx` vs `docs/design/v2/shell.jsx` |

### Forbidden-term drift (glossary)

- “Parallel **Worker** Slots”, “**Account** default” — `WorkflowBuilder.tsx`
- Lucide `Bot` icons — several pages
- “Job description” widely used — consider “Agent brief” / “Role brief”

### Prototype ↔ route map (high-signal)

| Prototype | Route | Component | Match |
|-----------|-------|-----------|-------|
| AF2_Home | `/` | `Dashboard.tsx` | High |
| AF2_Missions | `/mission-state` | `MissionState.tsx` | High |
| AF2_Approvals | `/approvals` | `Approvals.tsx` | High |
| AF2_Activity | `/agents/activity` | `AgentActivity.tsx` | High (data source wrong) |
| AF2_Studio | `/builder` | `WorkflowBuilder.tsx` | Partial |
| AF2_Integrations | `/integrations/mcp` | `MCPIntegrations.tsx` | Medium |
| — | `/mission-assignments` | `Tickets.tsx` | Not in prototype |
| — | `/waitlist` | `LandingPage.tsx` | Off-brand |

---

## Responsiveness — **Ticket candidate (P1 UX)**

**Finding:** `dashboard/src/af2-components.css` uses fixed grids (e.g. `.af2-stats` = 4 columns) with **no `@media` rules**. `Layout.tsx` has mobile nav; page content does not stack.

**Worst overflow:** `Approvals.tsx` (6-col grid), `Dashboard.tsx` (5-col mission table), `Tickets.tsx`, `BudgetDashboard.tsx`, `MCPIntegrations.tsx`.

**Quick wins:**

1. `.af2-stats` → 2×2 mobile, 4-col `lg+`
2. `.af2-list` → card/stack below `md`
3. `.af2-page-head` → `flex-wrap`, stack actions on narrow viewports

v2 prototypes inherit desktop-only grids — responsive work is an explicit product gap, not accidental one-off.

---

## Product loop detail (per AGENTS.md step)

### Sign up — OK

- `/login?mode=signup`, Supabase + `/api/auth/social`
- Workspace lazy-provision: `src/workspaces/workspaceRoutes.ts`

### Workspace + company — Partial

- Company implicit via `ensureDefaultCompany()` on first mission
- No dedicated company onboarding UI

### Mission + hiring plan — OK with ordering issue

- `/hire`, `/hire/plan/:missionId/:planId`, full mission/hiring APIs
- **Gap:** `Hire.tsx` blocks generate until LLM config; backend `generate-plan` requires BYOK — conflicts with MVP order (hosted models on Flow tier)

### Confirm agents — OK, incomplete handoff

- `POST /api/hiring-plans/:id/confirm` — agents, org_edges, activity_events
- **Gap:** No `requireEntitlement("agentCap")` on confirm; no routines/workflows seeded

### Connect tools — Partial

- Live: `/integrations/mcp` — Slack, Gmail, HubSpot, Linear, Sentry, Stripe, Teams, Apollo, Composio
- GitHub not in `liveConnectorCatalog.ts`; `IntegrationMarketplace.tsx` unrouted

### LLM / hosted — Partial

- BYOK: `/settings/llm-providers`, gated by `byokAllowed`
- Hosted works in workflow steps, not hiring-plan generation
- `explore.byokAllowed: true` temporary in `entitlements.ts`

### Deploy routine — Broken

See P0-1

### First run — Partial

- `POST /api/runs` + `requireEntitlement("runsPerMonth")`
- No guided “Run now” on standing tasks; check-in/handoff create tickets, not runs

### Approval / ticket — OK

- `/approvals`, `/mission-assignments`
- Explore `approvalTierMax: 0` blocks approval policies

### Activity + cost — Partial

See activity handoff; budget stubs; HEL-118 cost rollup pending

---

## Entitlements & billing

`requireEntitlement` only on:

| Feature | Location |
|---------|----------|
| `runsPerMonth` | `app.ts` POST `/api/runs` |
| `byokAllowed` | `llmConfigRoutes.ts` POST `/` |
| `agentCap` | `controlPlaneRoutes.ts` deploy only |
| `integrationCap` | `integrationRoutes.ts` POST connections |
| `approvalTierMax` | `approvals/policyRoutes.ts` |

**Not gated:** hiring confirm, mission generate-plan, workflow create.

**Marketing mismatch:** `Pricing.tsx` copy vs `PLAN_LIMITS` in `entitlements.ts`.

---

## Azure deprecation (HEL-11)

No Azure in `src/`. Remaining artifacts:

- `k8s/production/*.yaml`, `k8s/staging/*.yaml` — `azurecr.io`, workload identity
- `skills/azure-skills/`, `agents/qa-engineer/skills/azure-skills/`
- README, `content/articles/*`, `content/sales/battle-cards.md`

---

## E2E / CI signal

`dashboard/e2e/golden-path.spec.ts` — Phases 6–13 still `test.fixme` (HEL-85, HEL-26, HEL-27, HEL-29, Slack connector, etc.) despite partial UI shipping. URL assertions may be stale (`/team` vs `/workspace/org-structure`).

---

## Suggested UI features (post-audit, when prioritizing)

| Feature | Rationale |
|---------|-----------|
| Post-confirm onboarding checklist | Close handoffs after hire |
| “Run now” on Standing Tasks | First run + cost attribution |
| Sidebar spend ring | Budget always visible |
| Agent / Mission modals (v2 prototypes) | Less navigation churn |
| Command palette (⌘K) | Topbar stub exists |
| Settings Billing tab | Subscription + Stripe portal |
| Hosted LLM for hiring on Explore | Flow tier product fit |
| Tier routing editor | Replace LLMProviders stub |

---

## Sub-issue breakdown (for Linear)

When splitting work, suggested children:

| ID | Title | Priority |
|----|-------|----------|
| 1 | Add POST /api/routines + scheduler + confirm seed/CTA | P0 |
| 2 | Fix Settings /api/profile → /api/user/profile | P0 |
| 3 | Wire knowledge reflection LLM + embed deps | P0 |
| 4 | Activity page → /api/activity-events + run emits | P1 |
| 5 | Hosted LLM for mission generate-plan (Explore/Flow) | P1 |
| 6 | requireEntitlement agentCap on hiring confirm | P1 |
| 7 | Settings billing tab + subscription API client | P1 |
| 8 | Wire Pause all → company/lifecycle | P1 |
| 9 | af2 responsive CSS (stats, lists, page-head) | P1 |
| 10 | Remove proposal 404 mocks; gate WorkflowBuilder | P2 |
| 11 | Delete or archive IntegrationMarketplace.tsx | P2 |
| 12 | WorkflowBuilder v2 node colors + af2-card panels | P2 |
| 13 | Unblock golden-path E2E phases | P2 |
| 14 | Azure artifact cleanup + CI grep | P2 |
| 15 | v2 typography (Geist default) + Af2Button/Page wrappers | P2 |

---

## Audit metadata

| Field | Value |
|-------|--------|
| Date | 2026-05-19 |
| Branch audited | `dev` |
| Agent | Cursor Cloud (read-only audits) |
| Linear MCP | Unavailable (needs auth in IDE) — file manually from this doc |
| Implementation | **None** — review document only |
