# AutoFlow — Stickiness & Gamification: Audit + Ideation

> **Mode:** Audit + creative ideation. **No build, no tickets** until Brad approves a set (§7 of the directive).
> **North star:** Make AutoFlow's *compounding value impossible to ignore*, and make leaving feel like throwing away a workforce that has learned the business.
> **Strategic spine:** The moat is the three-layer agent memory (Instructions / Knowledge / Episodes) + the accumulating record of runs. Surface mechanics are *instruments that make compounding value legible* — never the value itself.

Grounded in a six-vector codebase sweep of `bdunk881/paperclipai`. File:line evidence is cited throughout.

---

## Part 0 — Corrections to the §3 grounding context

Two items in the directive's grounding context are stale or optimistic; flagging per §4 instructions.

| §3 claim | Ground truth | Evidence |
|---|---|---|
| "three Stripe tiers — Flow, Automate, Scale" | **Four** tiers. A free **Explore** ($0, 25 runs/mo, 1 agent, 1 integration) sits beneath Flow ($19) / Automate ($49) / Scale ($99). | `migrations/079_subscription_tiers.sql:48-59`, `082_subscription_tiers_landing_polish.sql` |
| "Wake-ups: event-driven via a triage policy system (replaced heartbeat polling)" | The *intent* exists but the executor does not. An `agent_wake` notification channel is defined, but **no dispatcher** processes it. The general notification **sweep is never auto-invoked** — digests only send if something POSTs `/api/notifications/sweep`. The `end_of_week_review` HITL checkpoint has **no scheduler** in-repo. | `src/hitl/hitlStore.ts:36`, `src/notifications/service.ts:171-300`, `routes.ts:225` |

Implication: some "return triggers" we assume are firing may be silently dormant. This *raises* the value of the quick wins below — we may be leaving existing reasons-to-return on the floor.

---

# PHASE 1 — AUDIT FINDINGS

## 1.1 The current core loop (annotated)

```
                         ┌─────────────────────────────────────────────┐
   SIGN UP ──► MFA GATE ─► HOME ("Today") ──► sidebar: RUN / WORKFORCE / BUILD
   (email/    (hard      │  4 stat tiles:        │
    oauth/     block,    │   • approvals waiting │  RUN: Home, Missions, Assignments,
    passkey)   /onboard-  │   • assignments open │       Approvals, Connections, Memory
               ing/mfa)   │   • SPENT in range   │  WORKFORCE: Team, Hire, Budget
                          │   • missions live    │  BUILD: Routines
                          │  "Needs your stamp"  │
                          │  "Live missions"     │
                          │  spend + presence    │
                          └──────────────────────┘
   First-run aids: OnboardingBanner (empty workspace only, dismissible forever)
                 + OnboardingTour (4 tooltips, browser-local localStorage)
```
Evidence: `dashboard/src/pages/Dashboard.tsx:361-424`, `components/Layout.tsx:42-78`, `components/OnboardingBanner.tsx`, `components/OnboardingTour.tsx`, `pages/Hire.tsx`.

**The loop as a behavioral sequence (trigger → action → outcome → reason to return):**

| Step | Today | Reason to return created? |
|---|---|---|
| Trigger | An approval/ticket/SLA event happens server-side | ⚠️ Notification delivery is fragmented across 3 stores and the sweep isn't auto-run |
| Action | User resolves an approval inline on Home (crisp drawer) | ✅ This is the strongest existing loop — high-agency, fast |
| Outcome | Workflow resumes; agent "wakes up" | ⚠️ No follow-up: "here's what the agent produced after your call" |
| Reason to return | Mostly *external* (the work itself is due) | ❌ The product creates few of its own pull-back reasons |

**Verdict:** The approval ritual is the one genuinely good return loop. Almost everything else that *could* pull a user back — value delivered, agents getting smarter, weekly recaps, usage milestones — is either invisible, dormant, or unbuilt.

## 1.2 THE central finding — the value is invisible

AutoFlow is an automation product that **never tells the user what it accomplished for them.** This is the single biggest stickiness gap.

- The home dashboard frames cost as **outflow** ("spent in range") and shows **zero** value-delivered metrics — no runs completed, hours saved, tasks automated, errors caught. `Dashboard.tsx:398-424`.
- A **"Cost per hour saved" ROI metric already exists in the code but is hidden in a `display:none` div** (kept only for tests). `BudgetDashboard.tsx:524-527`. This is the smoking gun: we built the value metric and then hid it.
- A full **report-generation service exists** (`tasks_completed`, `executions`, `active_agents`, board memos, financial statements) with **no UI to trigger or view it** and **no scheduled digest**. `src/reporting/reportService.ts:102-241`.
- Workflow **success-rate / p50-p99 / last-30-runs** stats exist — but only inside the WorkflowBuilder debugging view, never surfaced as accumulated competence. `dashboard/src/pages/WorkflowBuilder.tsx`.

> An automation product that works invisibly trains the user to forget it's earning its keep — which makes the renewal/churn decision a coin flip with no evidence on AutoFlow's side.

## 1.3 The moat is real but invisible (compounding-value gap)

The three-layer memory is fully implemented and **accumulates continuously**:
- **Instructions** (versioned, workspace/mission/agent-scoped) — `migrations/034_three_layer_memory.sql:26-56`
- **Knowledge** (pgvector RAG, trust-scored, `superseded_by` conflict handling; grows via explicit `save_memory` *and* an automatic reflection job that clusters episodes → synthesized facts) — `034:63-101`, `src/knowledge/reflectionJob.ts`
- **Episodes** (append-only, 90-day TTL, `reflected_at` tracking) — `034:126-167`, `src/knowledge/saveMemoryTool.ts`

**But the only user-facing surface is a flat browse/edit page** (`dashboard/src/pages/Memory.tsx`, three tabs). There is:
- ❌ No agent "maturity / learning" indicator anywhere — `AgentDetail.tsx` and `OrgStructure.tsx` show presence + budget, nothing about accumulated memory.
- ❌ No "your agents learned X this week," no growth graph, no episode/knowledge counts, no reliability trend.
- ❌ No stats API (`/agents/:id/stats`, `/workspace/memory-growth` don't exist).

**Consequence:** the deepest game we could offer — *"your AI workforce is visibly getting better, and here's the proof"* — is completely unbuilt, even though the data to power it already exists.

## 1.4 Ranked stickiness gaps (tagged by pillar)

Pillars: **HR** = Habitual Return · **CV** = Compounding Value · **SC** = Switching Cost

| # | Gap | Pillar | Severity | Evidence |
|---|---|---|---|---|
| 1 | **Value delivered is never shown** (ROI/hours-saved/runs-completed); spend framed as pure cost; ROI metric literally hidden | CV, HR | 🔴 Critical | `Dashboard.tsx:398-424`, `BudgetDashboard.tsx:524-527` |
| 2 | **Agent learning/maturity invisible** — moat accumulates with zero legibility | CV, SC | 🔴 Critical | `Memory.tsx`, `AgentDetail.tsx`, `OrgStructure.tsx` |
| 3 | **No behavioral instrumentation** — cannot measure activation, TTFV, DAU/WAU, D1/D7/D30, retention | (enabler) | 🔴 Critical | `src/observability/store.ts`, `dashboard/src/sentry.ts` |
| 4 | **No product-created return cadence** — report service + digests exist but are never scheduled/sent | HR | 🟠 High | `reportService.ts`, `notifications/service.ts:171-300` |
| 5 | **Onboarding is fragmented & un-tracked** — dismissible banner + browser-local tour, no server progress, no first-run win, MFA hard-gate first | HR | 🟠 High | `OnboardingBanner.tsx`, `OnboardingTour.tsx`, `MfaEnrollmentWizard.tsx` |
| 6 | **Workflow reliability not surfaced as competence** — "ran N times at M% success" only in builder | CV, SC | 🟠 High | `WorkflowBuilder.tsx` |
| 7 | **Expansion is silent-until-402** — no "80% of runs used" meter; hard cap then upgrade prompt | SC | 🟡 Medium | `entitlements.ts:25-66`, `UpgradeBanner.tsx:143-228` |
| 8 | **No team/shared-impact visibility** — members can't see collective progress; product is "build alone" | SC | 🟡 Medium | `workspaceRoutes.ts`, `OrgStructure.tsx` |
| 9 | **Flat integration/marketplace discovery** — 35 native + 87 skills, zero social proof, no recipes, no sharing | HR, SC | 🟡 Medium | `integrationCatalog.ts`, `skillsRoutes.ts:16` |
| 10 | **Approval ritual has no responsiveness loop or post-action payoff** — `requested_at`/`decided_at` stored but no response-time surface; no "here's the result" after approving | HR | 🟡 Medium | `src/engine/approvalStore.ts:129-316` |

## 1.5 Instrumentation gap list (must-land-first dependencies)

The product has **operational observability** (`activity_events`: run/issue/budget/heartbeat/alert) and **Sentry** (errors + perf + replay) — but **no behavioral/product analytics**. No PostHog/Segment/Amplitude in the dashboard (the `src/integrations/posthog/` folder is a *connector for customers' own PostHog*, not our instrumentation).

| Signal needed | Measurable today? | What's missing |
|---|---|---|
| Activation rate | ❌ | `onboarding_step_completed` events |
| DAU / WAU / MAU, D1/D7/D30 | ❌ | `user.login` / `session_started` events (only `last_login_at` column exists, not queried) |
| Time-to-first-value / first successful run | ⚠️ partial | joinable from `users.created_at` + `runs.created_at`, but no event |
| Runs-per-active-user | ✅ | queryable from `runs` |
| Approval response time | ✅ | `decided_at - requested_at` (not surfaced) |
| Feature adoption / "first use of X" | ❌ | first-use events |
| Memory growth / reflection impact | ⚠️ | counts exist in tables; no aggregation API or events |

**Conclusion:** an instrumentation foundation (lightweight `user.*` and `activation.*` events into the existing `observabilityStore`, plus a thin aggregation read API) is a **hard prerequisite** for measuring whether *any* mechanic below works. Per §2 "instrumentation-first," nothing ships unmeasured — so this sequences first.

---

# PHASE 2 — IDEATION CATALOG (broad), then convergence

Each concept is run through the design lenses (§5a): **Hook** (Trigger→Action→Variable Reward→**Investment**), **Octalysis** core drive, **SDT** (competence/autonomy/mastery), **Fogg** (B=MAP). Every concept carries an **anti-gimmick check** (§5d).

### A. Value legibility (the cheapest, highest-leverage territory)
- **A1 · "Value delivered" home card** — runs completed, est. hours saved, success rate, value-vs-cost. *Hook:* trigger=login, reward=visible accomplishment, investment=accrued history. *Octalysis:* Development & Accomplishment. *Anti-gimmick:* it's literal ROI, the most respect-building thing we can show a buyer. *Effort:* S (unhide `BudgetDashboard.tsx:527`, add card).
- **A2 · Reframe "spend" → "value"** — keep cost honest but lead with what the spend *bought*. *Effort:* S.
- **A3 · Workflow reliability badge** — "ran 342×, 99.2% success" on routine/workflow rows. *Octalysis:* Ownership. *Effort:* S–M (data exists in builder).
- **A4 · First-run impact confirmation** — "Your first automation is live; it'll run ~10×/wk." *Fogg:* prompt at peak motivation. *Effort:* S.

### B. Return cadence
- **B1 · Weekly "what your workforce did" digest** (email + inbox) — wire `reportService` + fix the dormant sweep. *Hook:* external trigger that pulls the user back; variable reward (different wins each week). *SDT:* competence. *Anti-gimmick:* it's a genuine status report, not a nag. *Effort:* M (scheduler + template).
- **B2 · Post-approval payoff** — after approving, show "here's what the agent did with your decision." *Hook:* closes the loop, variable reward. *Effort:* M.
- **B3 · Usage/consumption meters + proactive upgrade moments** — "800/1000 runs used." *Anti-gimmick:* transparency, the opposite of a dark pattern (today it's silent-until-402). *Effort:* S–M.

### C. The moat made visible (strategic)
- **C1 · Agent Maturity card** — episodes logged, knowledge synthesized, reliability trend, "learned X this week," with a maturity arc. *Hook investment:* every run deepens a visible asset → switching cost rises each pass. *Octalysis:* Development & Accomplishment + Ownership. *SDT:* mastery. *Anti-gimmick:* this is the moat, quantified — maximally credible. *Effort:* L (stats API + reflection-impact metrics + UI).
- **C2 · "Your workforce learned this week" recap** — narrative tying episode→knowledge synthesis to outcomes; feeds B1. *Effort:* M (on top of C1).
- **C3 · Investment-deepening teach loops** — make correcting an episode / promoting knowledge / approving a synthesized fact a first-class, rewarding action. *Hook:* this *is* the Investment step; each teach raises switching cost. Ties HITL → memory. *Effort:* M–L.

### D. Team / multiplayer (switching cost via organizational lock-in)
- **D1 · Shared team impact dashboard** — "your team automated X, saved Y hrs." **Shared wins, not ranked individuals** (§5b caution). *Octalysis:* Epic Meaning + Ownership. *Anti-gimmick:* avoid leaderboards; celebrate collective outcomes. *Effort:* M–L.
- **D2 · Lightweight collaboration on agents** — comments/handoffs so teammates build on each other's agents. *Effort:* L.

### E. Onboarding / activation
- **E1 · Server-tracked activation checklist** — connect a model → hire first agent → first successful run → first approval → connect an integration; with real progress, re-surfaceable. Replaces the dismissible banner + browser-local tour. *Fogg:* sequence MAP for each step. *Octalysis:* Accomplishment. *Effort:* M.

### F. Integrations / marketplace / skills (mostly watch)
- **F1 · Capability-unlock momentum framing** — reframe flat catalog as progressive unlocks ("connecting CRM unlocks N templates"). *Effort:* M.
- **F2 · Marketplace social proof / recipe sharing** — usage counts, ratings, share to workspace. *Effort:* L. *Risk:* premature pre-first-customer; network effects need volume.

### G. Classic gamification (deliberately cut/parked — fails the §5d test)
- **G1 · Streaks** (daily-active / approval-response) — guilt-loop risk, reads childish for SMB ops software. *Verdict:* park; at most a quiet "consistency" stat, never confetti.
- **G2 · Badges / achievements** — vanity; sophisticated buyers feel patronized. *Verdict:* redesign as real capability unlocks (F1) or cut.
- **G3 · Leaderboards (ranked individuals)** — explicitly toxic for small teams (§5b). *Verdict:* cut; fold into D1 shared wins.

---

# PART 3 — PRIORITIZED RECOMMENDATION SET

Scored on Impact × Effort with time-to-signal called out. Ruthlessly shortlisted.

### 🟢 Quick wins (high impact · low effort · fast signal)

| ID | Recommendation | Pillar | Targets metric | Core-loop step | Effort | Time-to-signal | Confidence | Depends on |
|---|---|---|---|---|---|---|---|---|
| **QW-0** | **Behavioral instrumentation foundation** (login/signup/first-agent/first-run/activation events + thin aggregation API) | enabler | activation, TTFV, D1/D7/D30, WAU/MAU | — (measurement) | S–M | n/a | High | — |
| **QW-1** | **"Value delivered" home card + unhide ROI** (runs completed, hours saved, success %, value-vs-cost) | CV, HR | D7/D30 retention, WAU/MAU | Outcome legibility | S | ~2–4 wks | High | QW-0 |
| **QW-2** | **Weekly workforce digest** (wire `reportService` + revive dormant sweep) | HR | WAU, return rate | Return trigger | M | ~4 wks | High | QW-0, sweep scheduler |
| **QW-3** | **Activation checklist with server progress** (replaces banner+tour) | HR, CV | activation rate, TTFV | Onboarding→first value | M | ~3 wks | Med-High | QW-0 |
| **QW-4** | **Workflow reliability badge** ("ran N×, M% success") | CV, SC | runs-per-active-user | Outcome legibility | S–M | ~3 wks | Med-High | QW-0 |
| **QW-5** | **Usage meters + proactive upgrade moments** (no more silent-until-402) | SC | tier expansion (Flow→Automate→Scale), NRR | Expansion | S–M | ~4–6 wks | Med | QW-0 |

### 🔵 Strategic bets (high impact · higher effort · compounding)

| ID | Recommendation | Pillar | Targets metric | Effort | Time-to-signal | Confidence | Depends on |
|---|---|---|---|---|---|---|---|
| **SB-1** | **Agent Maturity surfaces** — "your AI workforce is visibly getting better" (episodes, synthesized knowledge, reliability trend, "learned X"). *The moat made visible — the deepest game.* | CV, SC, HR | D30 retention, NRR, churn | L | ~6–10 wks | High (strategic) | QW-0, stats API |
| **SB-2** | **"Your workforce learned this week" recap** (memory narrative; feeds the digest) | HR, CV | WAU/MAU, retention | M | ~8 wks | Med-High | SB-1, QW-2 |
| **SB-3** | **Investment-deepening teach loops** (correct an episode / promote knowledge / approve synthesized facts — ties HITL → memory growth) | SC | memory accumulation/account, retention | M–L | ~8–10 wks | Med-High | SB-1 |
| **SB-4** | **Team shared-impact dashboard** (shared wins, no leaderboards) | SC | seats, NRR | M–L | ~8 wks | Med | QW-0, QW-1 |

### ⚪ Watch / later (interesting · lower leverage or higher risk)

| ID | Item | Why parked |
|---|---|---|
| W-1 | Post-approval payoff (B2) | Good loop but lower leverage than value/maturity; revisit after QW set |
| W-2 | Marketplace social proof / sharing (F2) | Network effects need volume; premature pre-first-customer |
| W-3 | Integration capability-unlock framing (F1) | Medium leverage; sequence after activation + instrumentation |
| W-4 | Agent collaboration/comments (D2) | High effort; team count low pre-PMF |
| W-5 | Streaks / badges / leaderboards (G1–G3) | Fail the anti-gimmick test for sophisticated SMB buyers; cut or redesign |

### Recommended execution order (sequencing per §6 / §8)
**QW-0 (instrumentation) → QW-1 + QW-4 (cheap value legibility) → QW-3 (activation) → QW-2 (digest) + QW-5 (usage meters) → SB-1 (agent maturity) → SB-2 + SB-3 → SB-4.**
Rationale: nothing is measurable without QW-0; the quick wins surface value we *already* have for near-zero cost and start moving retention while SB-1 (the moat play) is built; SB-2/3 compound on SB-1.

### Target-metric definitions used above
Activation rate · time-to-first-value / first successful run · D1/D7/D30 retention · WAU/MAU stickiness ratio · runs-per-active-user · approval response rate · memory/episode accumulation per account · integrations-connected · tier expansion (Flow→Automate→Scale) · net revenue retention · churn · qualitative NPS.

---

## Tensions & honest trade-offs (per §9)
- **Quick wins vs. the spine:** the quick wins are *legibility of value we already create*; SB-1 is the *durable moat*. Do both — quick wins buy time and signal; SB-1 is the actual defensibility. Don't let the easy wins crowd out the bet.
- **Instrumentation tax:** QW-0 produces no user-visible feature, yet everything depends on it. The temptation will be to skip it and "eyeball" results. Resist — per §2 we don't ship unmeasured mechanics.
- **Free-tier reality:** with a $0 Explore tier, activation and habitual-return matter *more* than for a paid-only funnel — most users start with the least skin in the game. QW-3 and QW-1 are how Explore users feel enough value to convert.
- **B2B restraint:** the entire classic-gamification quadrant (streaks/badges/leaderboards) is parked or cut on purpose. The win condition here is *credibility*, not dopamine.

---

## Approval gate (§7)
**No Linear tickets will be filed until Brad approves a set.** Brad may approve all / some / none and may re-scope. On approval, work is filed as a Linear **project** ("AutoFlow Stickiness & Engagement") with one sub-issue per recommendation, sequenced instrumentation-first, each carrying problem, mechanic, hypothesis, target metric, acceptance criteria, instrumentation note, labels, priority, and dependencies (§8).
