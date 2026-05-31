# Sentry Monitors — Crons + Uptime

Part of the **Sentry observability hardening — maximize Team plan** project (HEL-347).
See also: `sentry-alerts-and-dashboards.md` (HEL-348) and the release/deploy CI in
`deploy-fly-api-*.yml` + `dashboard-cloudflare-pages.yml` (HEL-345/346).

> **Team-plan budget:** the Team plan includes **1 cron monitor + 1 uptime monitor**
> free; additional monitors are pay-as-you-go. We spend those on the two below.

---

## 1. Cron monitor — `observability-rollups` (automated)

**What it watches:** the `*/15 * * * *` GitHub Actions cron in
`.github/workflows/observability-rollups.yml`, which refreshes observability
rollups and enforces retention. If it silently stops or starts failing,
observability data quietly degrades — exactly the kind of thing a cron monitor
catches.

**How it's wired (no UI, no org token):**
- A **start** check-in (`status=in_progress`) is sent before the maintenance step,
  carrying `monitor_config` (crontab `*/15 * * * *`, `Etc/UTC`, 5-min check-in
  margin, 10-min max runtime). The first run **auto-creates/updates the monitor** —
  the `node-express` project, named `observability-rollups`.
- A **finish** check-in (`status=ok` / `error`) is sent in an `if: always()` step
  based on `job.status`.
- **Auth:** the workflow parses the runtime `SENTRY_DSN` ingest key and POSTs to
  `https://<host>/api/<project_id>/cron/observability-rollups/<public_key>/`. This
  uses the DSN's public ingest key — **not** the org auth token (which is
  release-scoped and can't manage monitors).
- Both check-ins are **gated on `SENTRY_DSN` presence and non-fatal** (`|| warning`),
  so they never block or fail the maintenance job.

**Why this job (and only this one):** the BullMQ schedulers in
`src/queue/scheduler.ts` are dynamic, per-tenant routine schedules — not a single
fixed cadence — so they don't map to one monitor. The infra rollup cron is the one
fixed, business-critical recurring job, which fits the Team-tier single-monitor budget.

**Verify after merge:** trigger `workflow_dispatch` (or wait for the next `*/15`
run) and confirm in **Sentry → Crons** that the `observability-rollups` monitor
exists and shows `in_progress → ok`. Temporarily break the maintenance step to
confirm it flips to `error`, and skip a run to confirm `missed` alerts fire.

---

## 2. Uptime monitor — production API health (manual — token-scope limited)

> The Infisical `SENTRY_AUTH_TOKEN` is an **org *release* token** — it returns 403
> on the org/monitors/uptime APIs, so it **cannot create an uptime monitor**. Create
> it in the **Sentry UI**, or mint a broader-scoped org token first.

**Config to apply** (Sentry → **Insights → Uptime** → *Create Monitor*):

| Field | Value |
| -- | -- |
| Name | `api.helloautoflow.com health` |
| URL | `https://api.helloautoflow.com/health` |
| Method | `GET` |
| Interval | 1 min (drop to 5 min to conserve quota) |
| Expected status | `200` |
| Environment | `production` |
| Project | `node-express` |
| Alert routing | same Slack + PagerDuty path as issue alerts (see `sentry-alerts-and-dashboards.md`) |

`/health` is the endpoint the Fly smoke tests already hit
(`infra/scripts/fly_api_smoke.sh`), so it's a known-good liveness signal.

**If scripting later (broader token required):** the supported path on Team is the
UI; if automating, confirm the current Sentry Uptime API shape against the docs
(`https://docs.sentry.io/product/uptime-monitoring/`) before relying on it — the
release token in Infisical is not sufficient.

---

## Token note

The org auth token in Infisical (`SENTRY_AUTH_TOKEN`, all envs) is intentionally
**release-scoped** (releases, source maps, deploy markers — HEL-345/346). It is
**not** sufficient for creating monitors, alerts, or dashboards. Those are applied
via the Sentry UI (or a separately-minted broader token) per the runbooks here and
in `sentry-alerts-and-dashboards.md`.
