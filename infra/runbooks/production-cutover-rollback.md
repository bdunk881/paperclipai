# Production API rollback runbook (post-HEL-96, post-HEL-97)

The HEL-96 cutover (DNS swap from `autoflow-fastapi-production.fly.dev` →
`autoflow-api-production.fly.dev`) is complete, and the FastAPI relay shim
was retired in HEL-97. `api.helloautoflow.com` now CNAMEs directly at the
Express app — there's no parallel FastAPI to revert to.

The rollback mechanism is now **Fly release rollback** on the same app.

## When to roll back

Trigger when **any** of:

- 5xx rate on `api.helloautoflow.com` rises above the previous-release
  baseline by 2× for >5 min sustained
- OAuth callback failures spike (Slack / Google / HubSpot / etc.)
- Stripe webhook deliveries fail or accumulate in their retry queue
- Sentry shows a flood of new errors tagged `src/auth/*`, `src/billing/*`,
  or `src/engine/*`
- Manual smoke (`infra/scripts/fly_api_smoke.sh
  https://api.helloautoflow.com`) returns anything other than green
- Customer-reported incident with no obvious unrelated cause

## Rollback

```bash
# Find the previous healthy release
flyctl releases -a autoflow-api-production

# Roll the active release back to the previous version
flyctl releases rollback <prior-version> -a autoflow-api-production

# Verify
curl -i https://api.helloautoflow.com/api/health
bash infra/scripts/fly_api_smoke.sh https://api.helloautoflow.com
flyctl status -a autoflow-api-production
```

Fly will redeploy the previous Docker image immediately — no CNAME change
needed since the hostname always pointed at the same app.

## Monitor

```bash
flyctl logs -a autoflow-api-production
flyctl status -a autoflow-api-production
```

Watch Sentry + Datadog for the regression clearing.

## Communications template

```
[SEV-X] Production API rolled back to release v<N-1> at <UTC>.

We detected <symptom> shortly after deploying v<N>. The Fly app has been
rolled back to v<N-1>; api.helloautoflow.com is serving traffic from the
previous-known-good image. No customer-facing outage beyond <duration>.

Investigating: <link to incident channel / postmortem doc>
```

## Post-mortem checklist

- [ ] Document what regressed (route surface, header, env var, etc.)
- [ ] Fix on dev, validate with `infra/scripts/fly_api_smoke.sh`
- [ ] Validate the same fix on staging (`autoflow-api-staging`)
- [ ] Deploy fix to prod and watch for the previously-observed signal
- [ ] Update this runbook if the failure mode reveals missing pre-flight
