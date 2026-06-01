# Sentry Alerts + AI-Agent Dashboard

Part of the **Sentry observability hardening — maximize Team plan** project (HEL-348).
Companion to `sentry-monitors.md` (crons + uptime, HEL-347).

> **Why this is a runbook, not code:** the org auth token in Infisical
> (`SENTRY_AUTH_TOKEN`) is **release-scoped** — it returns 403 on the alert,
> dashboard, and monitor APIs. Alerts and dashboards are therefore applied in the
> **Sentry UI** (or with a separately-minted broader org token). Each item below is
> specified concretely enough to recreate by hand or script later.

---

## Sentry setup overview (project capstone)

| Area | Status | Where |
| -- | -- | -- |
| Backend releases + deploys | **automated** | `deploy-fly-api-*.yml` (HEL-345) — `getsentry/action-release`, `node-express` |
| Frontend source maps + releases + deploys | **automated** | `dashboard-cloudflare-pages.yml` (HEL-346) — `@sentry/vite-plugin` + `sentry-cli`, `javascript-react` |
| LLM / AI-agent tracing + conversations | **automated** | `src/instrument.ts` — `anthropic/openai/googleGenAI` integrations + `streamGenAiSpans` + per-run `gen_ai.conversation.id` (HEL-321) |
| Cron monitor | **automated** | `observability-rollups.yml` (HEL-347) |
| Uptime monitor | **runbook** | `sentry-monitors.md` (HEL-347) |
| Alerts → Slack/PagerDuty | **runbook** | this doc |
| AI-agent dashboard | **runbook** | this doc |

Org `autoflow-mo` · projects `node-express` (backend) + `javascript-react` (frontend) · team `autoflow` · **Team plan**.

---

## Prerequisites — connect integrations

Settings → **Integrations** (Team plan includes these):
- **GitHub** — should already be connected (release commit association relies on it). Confirm `bdunk881/paperclipai` is linked so suspect-commits + stacktrace linking work.
- **Slack** — connect and pick an alerts channel (e.g. `#eng-alerts`).
- **PagerDuty** — connect and map a service for founder on-call (AGENTS.md "Sentry → PagerDuty" path).

---

## Alert rules

Apply under each project → **Alerts → Create Alert**. Set `environment:production` filters so dev/staging noise doesn't page.

### A. Issue alert — new production errors (both projects)
- **Trigger:** *A new issue is created*
- **Filters:** `level:error` (or higher); `environment:production`
- **Actions:** Slack `#eng-alerts`. Add **PagerDuty** only for `level:fatal` (or a separate high-priority rule) to avoid paging on every error.

### B. Issue alert — regressions (both projects)
- **Trigger:** *An issue changes state from resolved to unresolved*
- **Filters:** `environment:production`
- **Actions:** Slack `#eng-alerts` + PagerDuty (a regression in prod is page-worthy).

### C. Metric alert — backend API error rate (`node-express`)
- **Dataset:** errors (or transactions failure rate)
- **Metric:** `count()` of error events, or `failure_rate()` on transactions
- **Window:** 5 min
- **Thresholds:** warning > ~2% (or > N errors) → Slack; **critical** > ~5% (or sustained spike) → PagerDuty
- **Filters:** `environment:production`

### D. Cron + uptime (from HEL-347)
- Route the `observability-rollups` cron monitor's *missed/error* + the API uptime monitor's *down* alerts to the same Slack + PagerDuty targets.

> Team includes **metric alerts**; **anomaly-detection** alerts and unlimited metric
> monitors are Business-only — the static thresholds above are the Team-plan path.

---

## AI-agent observability dashboard

Dashboards → **Create Dashboard** → "AutoFlow — AI Agents & Reliability". Team allows
up to **20** custom dashboards. Builds on the `gen_ai.*` spans from HEL-321.

Widgets (dataset → visualization → query):

1. **LLM spend by model** — Spans → table/bar → group by `gen_ai.request.model`,
   `sum(gen_ai.usage.total_tokens)` (and input/output token splits). Approximates
   cost per model; pair with the `spend_entries` data for billed cost.
2. **LLM calls over time** — Spans → time series → `count()` where `span.op:gen_ai*`,
   grouped by `gen_ai.request.model`.
3. **Conversations over time** — Spans → time series → `count_unique(gen_ai.conversation.id)`
   (the per-run id from HEL-321) — proxy for agent-run volume.
4. **Agent-run errors** — Errors → time series → `count()` where the event is tagged to
   an agent run (filter by the agent/run tag the backend sets), `environment:production`.
5. **Backend API latency p95** — Transactions → time series → `p95(transaction.duration)`
   for `node-express`, `environment:production`.
6. **Error events by project** — Errors → time series → `count()` split by project
   (`node-express` vs `javascript-react`).
7. **Queue health** (if BullMQ spans are traced) — Spans → `p95`/`count` on the
   `runs` / `agent-prompt` queue processing spans; otherwise omit until instrumented.

> Exact field/function names vary by Sentry's current Trace Explorer / Discover
> syntax — confirm each widget query in the UI builder. The `gen_ai.*` attributes are
> emitted by the v10 AI integrations enabled in `src/instrument.ts`.

---

## Optional — Seer (AI root-cause / autofix)

Seer is a **paid add-on** on the Team plan (not included). If subscribed, it adds
AI issue root-cause + suggested fixes, and the Sentry MCP's `analyze_issue_with_seer`
tool can triage issues from here. Evaluate cost vs. value separately; not required for
the above.

---

## When a broader token exists

If a broader org token (scopes: `alerts:write`, `project:write`, dashboards, uptime)
is minted, these alerts/dashboards/uptime monitor can be scripted via the Sentry API
instead of the UI. Keep the **release-scoped** `SENTRY_AUTH_TOKEN` separate and
minimal — CI only needs the release scope.
