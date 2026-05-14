# HEL-85 — Dev golden-path verification runbook

The gate for the P2.5 consolidation. Run after `autoflow-api-dev` is live on
Fly and the dashboard's host map (HEL-84) points at `dev-api.helloautoflow.com`.
Every break gets a sub-ticket linked to HEL-85. This ticket closes when all
sub-tickets are Done or explicitly deferred.

## Pre-flight

| Check | How |
|---|---|
| Dev backend healthy | `curl -i https://dev-api.helloautoflow.com/health` → 200, `{"status":"ok"}` |
| Dev backend smoke | `bash infra/scripts/fly_api_smoke.sh https://dev-api.helloautoflow.com` → all green |
| Dashboard pointing at dev backend | Reload `dev.helloautoflow.com` → Network tab shows requests to `dev-api.helloautoflow.com` (not `autoflow-fastapi-dev.fly.dev`) |
| Sentry env tag | Sentry → AutoFlow project → filter by env `dev` is non-empty (recent errors logged) |
| Workspace seed | One test workspace exists with a test user that has `admin` role |

If any pre-flight fails, fix before walking the path.

## The 11-step golden path

Each step is a discrete acceptance criterion. Mark `[x]` on this runbook as
you go. Every failure → file a sub-ticket "HEL-85.<step> — <symptom>".

### 1. Anonymous → signup → first login
- [ ] Visit `dev.helloautoflow.com` in incognito → lands on the landing page
- [ ] Click "Sign up" → Supabase Auth flow completes → redirects to first-login wizard
- [ ] First-login wizard creates workspace + default company → lands on Home

### 2. Workspace shows on Home
- [ ] Home page renders with workspace name + role badge
- [ ] Sidebar shows the four pillars (Run / Workforce / Build / Connect)
- [ ] No Sentry errors logged for this session in the last 60s

### 3. Hire — mission intake
- [ ] Navigate to `/hire` → page renders with the v2 page-head
- [ ] Fill `Mission statement` with a real sentence (e.g., "Run weekly outbound to enterprise AI buyers")
- [ ] Fill at least 2 of the 4 structured prompts (industry, target customer, success metric, runway)
- [ ] Click `Save draft` → see saved-mission card appear in the list below
- [ ] (Optional) Click `Save & generate plan` → see plan-generation start (HEL-24)

### 4. Hiring plan review
- [ ] Navigate to the generated plan → page loads with the LLM-generated team structure
- [ ] Org-chart preview renders without console errors
- [ ] Click `Confirm agents` → agents row inserted, `org_edges` populated

### 5. Team page — org chart
- [ ] Navigate to `/team` → org chart visualization renders the agents from step 4
- [ ] Each agent card shows role, tier, status

### 6. Integrations — connect Slack (smoke-tier connector)
- [ ] Navigate to `/integrations` → Slack tile visible
- [ ] Click `Connect` → OAuth flow → returns to AutoFlow with success state
- [ ] Slack connection appears in workspace integration list
- [ ] No 5xx errors during the OAuth round-trip in Fly logs

### 7. Studio — create a routine
- [ ] Navigate to `/studio` → `@xyflow/react` canvas renders
- [ ] Drop in 2 nodes (e.g., schedule trigger → Slack post action) + connect them
- [ ] Save → routine appears in routines list

### 8. Trigger a manual run
- [ ] On the routine from step 7, click `Run now`
- [ ] Run is created (`workflow_runs` row); step results begin to populate
- [ ] No errors in Activity feed during the run

### 9. Resolve an approval gate (if the routine has one)
- [ ] If the run reached an approval node → Approvals page shows the pending item
- [ ] Click `Approve` → run resumes, gate clears
- [ ] (If no approval in the routine, mark this step N/A and link to a follow-up)

### 10. Activity feed + cost
- [ ] Navigate to `/activity` → recent events for the run visible
- [ ] Cost dashboard (`/budget` or Activity sidebar) shows non-zero LLM spend for the workspace

### 11. Settings — memory + budgets
- [ ] Navigate to `/settings/memory` → 3 tabs render (Instructions / Knowledge / Episodes)
- [ ] Create one workspace instruction via the inline editor → saves, appears in list
- [ ] Knowledge tab shows any seeded curated items (if HEL-93 seed has been run)
- [ ] Episodes tab shows agent activity from step 8's run
- [ ] Settings → Budget dashboard renders agent budgets correctly

## When all 11 are green

- Close HEL-85.
- Update [P2.5 project](https://linear.app/helloautoflow/project/p25-backend-consolidation-ts-express-on-fly-a2f0e7006ec9) status → "In Progress" or "Done" depending on remaining cutover work.
- Trigger HEL-95 (staging cutover) using the same backend + golden path.

## When a step fails

1. File `HEL-85.<step>` as a Linear sub-ticket linked to HEL-85.
2. Capture: console error, Network tab response, Sentry event ID, Fly log timestamp.
3. Continue the walk-through (don't block on one failure unless it cascades).
4. Mark the step `[~]` (in-progress) on this runbook.
5. After all 11 steps are walked once, sort sub-tickets by severity and fix.

## Automated coverage

`dashboard/e2e/golden-path.spec.ts` codifies steps 1–4. Steps 5–11 are
manual for v1 — many touch real OAuth providers, Stripe, and the LLM
provider, which makes deterministic Playwright tests expensive. A
follow-up ticket (`HEL-85.automate`) can add mock-LLM + mock-OAuth
Playwright coverage for steps 5–7 once the wiring is stable.
