# Production cutover rollback runbook (HEL-96)

The production cutover (`api.helloautoflow.com` swap from
`autoflow-fastapi-production.fly.dev` → `autoflow-api-production.fly.dev`)
is a DNS-only change. If something regresses post-cutover, you revert the
CNAME and traffic returns to the FastAPI app within DNS-propagation seconds.

## When to roll back

Trigger the rollback when **any** of:

- 5xx rate on `api.helloautoflow.com` rises above the pre-cutover baseline
  by 2× for >5 min sustained
- OAuth callback failures spike (Slack/Google/HubSpot/etc.)
- Stripe webhook deliveries fail or accumulate in their retry queue
- Sentry shows a flood of new errors tagged `src/auth/*`, `src/billing/*`,
  or `src/engine/*`
- Manual smoke (running `infra/scripts/fly_api_smoke.sh
  https://api.helloautoflow.com`) returns anything other than green
- Customer-reported incident with no obvious unrelated cause

## Pre-flight (24h before cutover)

```bash
# Lower api.helloautoflow.com Cloudflare DNS TTL so revert is fast
# (Cloudflare → DNS → api → edit → TTL: 60 seconds)

# Capture current FastAPI baseline metrics
flyctl status -a autoflow-fastapi-production
curl -s https://api.helloautoflow.com/health | jq .
```

## Cutover

```bash
# Verify new app is healthy
curl -i https://autoflow-api-production.fly.dev/health   # → 200 status:ok
bash infra/scripts/fly_api_smoke.sh https://autoflow-api-production.fly.dev

# Swap the CNAME in Cloudflare:
#   api.helloautoflow.com  CNAME → autoflow-api-production.fly.dev
#   (was autoflow-fastapi-production.fly.dev)
# Keep proxied=false so Fly issues the Let's Encrypt cert directly.

# Allocate Fly cert for the custom domain
flyctl certs add api.helloautoflow.com -a autoflow-api-production
flyctl certs check api.helloautoflow.com -a autoflow-api-production
# Wait until "Configured" — usually 30-60s.

# Verify
curl -i https://api.helloautoflow.com/health
```

## Monitor for 1 hour

Watch Sentry + Datadog + Fly logs:

```bash
flyctl logs -a autoflow-api-production --since 1h
flyctl status -a autoflow-api-production
```

If clean, raise the TTL back to 300s after 1h.

## Rollback (if needed)

```bash
# Cloudflare → DNS → api.helloautoflow.com → edit
#   CNAME target: autoflow-fastapi-production.fly.dev   (was autoflow-api-...)
# Wait 60s for the lowered TTL to propagate. Verify:
curl -i https://api.helloautoflow.com/health

# The FastAPI app is still running and was warm the entire time — there's
# no cold-start delay on the revert.

# Stop the broken new app to save Fly machine-hours while you debug
flyctl scale count 0 -a autoflow-api-production

# Capture the failure mode for the postmortem
flyctl logs -a autoflow-api-production --since 1h > artifacts/cutover-incident-$(date +%Y%m%d).log
```

After rollback, file a sub-ticket against HEL-96 with the failure mode
captured. Fix on dev/staging first, re-run smoke, then re-attempt cutover.

## Communications template

```
[SEV-X] Production API rollback completed at <UTC>.

We detected <symptom> following the cutover from autoflow-fastapi-production
to autoflow-api-production. CNAME has been reverted; api.helloautoflow.com
now serves the legacy FastAPI app as before. No customer-facing outage
expected beyond the 1-2 minute DNS propagation window.

Investigating: <link to incident channel / postmortem doc>
```

## Post-mortem checklist

- [ ] Document what regressed (route surface, header, env var, etc.)
- [ ] Fix on dev, validate with the smoke script
- [ ] Validate the same fix on staging (HEL-95 staging app)
- [ ] Schedule the next cutover attempt with the fix incorporated
- [ ] Update this runbook if the failure mode reveals a missing pre-flight
