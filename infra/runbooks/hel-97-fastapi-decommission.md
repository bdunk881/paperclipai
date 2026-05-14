# HEL-97 — FastAPI decommission runbook

Final cleanup. Removes the legacy FastAPI surface that the P2.5 consolidation
replaced. **Run only after the production cutover (HEL-96) has been stable
for ≥ 7 days.**

This runbook is split into a code-deletion PR (which you ship from any
machine) and Fly app destroy commands (which you run with `flyctl`).

## Pre-flight

| Check | How |
|---|---|
| Prod stable ≥ 7 days | `flyctl status -a autoflow-api-production --json | jq .status` → "deployed" continuously for 7d. Sentry baseline matches pre-cutover. |
| No production traffic on legacy app | `flyctl logs -a autoflow-fastapi-production --since 168h | wc -l` → near-zero request lines (only Fly health checks) |
| Stripe webhooks delivered to new app | Stripe Dashboard → Webhooks → last 7d shows 200s, no retries |
| Tier-1 OAuth callbacks delivered to new app | Slack/Google/HubSpot last 7d show successful auth flows |
| Sentry alert routing pointed at new app | Sentry → Settings → Alerts → DSN per env points at the new Fly app |

If any pre-flight fails, do NOT proceed. Triage the failure (the rollback
runbook covers this), restabilize, and reset the 7-day timer.

## Code deletion (PR)

Branch from `dev`:

```bash
git checkout -b brad/hel-97-fastapi-decommission
```

### Files + directories to delete

```bash
git rm -r backend/
git rm -r docker/backend/
git rm fly.dev.toml fly.staging.toml fly.production.toml fly.toml  # if present
git rm .github/workflows/deploy-fly-fastapi-dev.yml
git rm .github/workflows/deploy-fly-fastapi-staging.yml
git rm infra/scripts/fly_fastapi_smoke.sh
git rm infra/runbooks/fly-fastapi-staging.md
```

### Files to update

`.github/workflows/attach-fly-production-domain.yml` — change defaults:
- `default: autoflow-fastapi-production` → `default: autoflow-api-production`
- `default: api.helloautoflow.com` (unchanged)

`.github/workflows/publish-api-ipv4-record.yml` — change defaults:
- `default: api.helloautoflow.com` (unchanged)
- Any FastAPI-specific app name references → `autoflow-api-production`

`infra/README.md` — drop the "FastAPI Fly.io" section entirely. Update the
DNS table + env vars list to reflect TS Express.

`infra/runbooks/dev-deploy.md` — rewrite for the Express-only flow. Reference
`infra/runbooks/fly-api-dev.md` (already in place from HEL-83).

`docs/alt-2323-phase-3-backend-audit.md` — prepend a "**Closed — completed
via [P2.5 — Backend consolidation](https://linear.app/helloautoflow/project/p25-backend-consolidation-ts-express-on-fly-a2f0e7006ec9).**" footer.
Keep the document as historical record (it's an audit trail of what was
broken pre-cutover).

### Infisical secrets to remove

Per-env (dev/staging/production):

- `FASTAPI_EDGE_RELAY_BASE_URL`
- `FASTAPI_EDGE_RELAY_HOST_HEADER`
- `FASTAPI_EDGE_RELAY_INSECURE_TLS`
- `UVICORN_WORKERS`, `UVICORN_LOG_LEVEL`, any other Python-runtime-only vars

### Code references to remove

```bash
git grep -i "from edge_proxy\|edge_proxy.py" -- '*.py'
# Should be empty after backend/ is gone.

git grep -i "FASTAPI_EDGE_RELAY" -- '*.ts' '*.tsx' '*.js' '*.yml'
# Should be empty.

git grep -i "import httpx" -- 'src/**' 'dashboard/**'
# Should be empty (httpx was Python-only).

git grep -i "autoflow-fastapi" -- ':!docs/alt-2323-phase-3-backend-audit.md' ':!infra/runbooks/hel-97-fastapi-decommission.md'
# Should be empty except the audit trail + this runbook.
```

### Acceptance + smoke

```bash
npm run build          # TS compile must pass
npm test               # Existing test suites still pass (no Python tests run)
cd dashboard && npm run build && npx vitest run

# CI is green with no Python toolchain anywhere — check the Actions tab
# after pushing this PR.

# Documentation links resolve (no broken markdown links)
npx markdown-link-check AGENTS.md README.md infra/README.md
```

Open the PR, get CI green, merge to `dev`.

## Fly app destroy

After the code-deletion PR is merged + deployed to all three envs without
incident:

```bash
# Stop the machines first so any straggling requests fail closed rather than
# silently routing through a half-decommissioned app
flyctl scale count 0 -a autoflow-fastapi-dev
flyctl scale count 0 -a autoflow-fastapi-staging
flyctl scale count 0 -a autoflow-fastapi-production

# Wait 24h. Re-check Sentry and Datadog for any traffic that hit the
# stopped apps.

# Destroy the apps. Use --yes to confirm in CI / scripted contexts.
flyctl apps destroy autoflow-fastapi-dev --yes
flyctl apps destroy autoflow-fastapi-staging --yes
flyctl apps destroy autoflow-fastapi-production --yes

# Release the now-orphaned Fly certs
# (Fly auto-cleans certs whose app is destroyed; no manual step needed.)
```

## Sentry + Datadog cleanup

- Sentry → Projects → archive `autoflow-fastapi-*` projects (don't delete
  — Sentry retains issue history for audit even after archive).
- Datadog → Sources → remove `autoflow-fastapi-*` integrations.
- Cloudflare Analytics → no action; analytics tied to hostname, not app.

## Closing the ticket

- Update [HEL-97 Linear ticket](https://linear.app/helloautoflow/issue/HEL-97):
  - Check off every acceptance criterion
  - Link the code-deletion PR
  - Note the Fly destroy date
- Mark the [P2.5 project](https://linear.app/helloautoflow/project/p25-backend-consolidation-ts-express-on-fly-a2f0e7006ec9)
  status → Done. Update the project summary with the actual cutover dates.

Done. The consolidation is complete.
