# Cloudflare Workers + Durable Objects (cf-worker)

This document covers the AutoFlow Durable Objects substrate that lives in `cf-worker/`. It's the reference for everyone adding new DOs (HEL-291 through HEL-296 onwards).

## Where things live

| Path | Purpose |
|---|---|
| `cf-worker/` | The Cloudflare Worker project. Independent npm workspace (own `package.json`, `package-lock.json`, `tsconfig.json`). |
| `cf-worker/src/index.ts` | Worker entry — routes incoming requests to DO instances. |
| `cf-worker/src/durable-objects/` | One file per DO class. |
| `cf-worker/wrangler.toml` | DO bindings, env vars, per-env Worker names. |
| `src/lib/cfWorker/client.ts` | Server-side helper for every backend call to the Worker. Centralizes timeout, fail-open policy, observability. |
| `src/middleware/requireCfWorker.ts` | Express middleware that verifies a Worker→server JWT. Mounted at `/api/internal/*`. |
| `src/internal/routes.ts` | Routes the Worker can hit on the API. |
| `.github/workflows/cf-worker.yml` | CI: typecheck + vitest on PR; deploy on push to dev/master. |

## When to use a Durable Object

Use a DO when you need **atomic state per key** that survives across pods and outlasts a single request — and the existing primitives can't give you that cheaply.

| Need | Primitive |
|---|---|
| Atomic increment-and-check per `{scope, key}` | **DO** (e.g. rate limiter, quota counter) |
| Single-writer event sequencing per key | **DO** (e.g. webhook delivery state machine) |
| Long-lived WebSocket fan-out per resource | **DO** (with WebSocket hibernation) |
| Single-pod cron-like serialization across many keys | **DO** + alarms |
| Run-once-across-pods job lock | PG advisory lock (cheaper, already proven) |
| Cache that survives 60s | Redis (already provisioned) |
| Cache that survives process restart | Postgres table |
| Idempotency of a single HTTP webhook | Postgres unique constraint + try/catch |

DOs cost money and add a network hop. Default to the boring primitives when they fit.

## Naming conventions

### DO class names

PascalCase, suffixed with `DO`: `RateLimiterDO`, `WebhookSubscriptionDO`, `WorkflowRunDO`.

### DO instance IDs

Always derived via `env.<BINDING>.idFromName(key)` — never `newUniqueId()` unless the instance is intentionally ephemeral. Key format: `"{scope}::{value}"`, e.g.:

- `"workspace::abc-123"` for a per-workspace counter
- `"api-key::xyz-789"` for a per-API-key counter
- `"webhook::stripe::evt_abc"` for per-event webhook state

The double-colon makes it visually grep-able in logs. Don't include slashes or characters that look like URL segments.

### Wrangler bindings

`UPPER_SNAKE_CASE` matching the class purpose: `HEALTH_CHECK`, `RATE_LIMITER`, `WEBHOOK_IDEMPOTENCY`.

## Fail-open vs fail-closed

The server-side `callWorker` helper defaults to **fail-open**: on Worker outage, the call returns `{ ok: false, errorReason }` and the caller proceeds as if no limit was hit. This matches HEL-291's stated fallback policy — a Worker outage degrades rate limiting to allow-all rather than blocking all customer traffic.

Opt into **fail-closed** for security-sensitive callers by passing `{ onFailure: "fail-closed" }`:

```ts
const result = await callWorker("/quota/reserve", { method: "POST", body: ... }, {
  onFailure: "fail-closed",   // throw on Worker failure
  timeoutMs: 200,             // override default 100ms
});
```

When in doubt, prefer fail-open and add a follow-up ticket to revisit if the threat model says otherwise.

## Timeouts

Default per-call: **100ms**. The Worker is in the same AWS region as the Fly API (us-east-1) so p99 should be well under 50ms. The 100ms cap exists to fail loudly when something is wrong, not to be a hot-path budget.

Override per call when the work justifies it (e.g. webhook delivery state machines may need 500ms). Don't override globally.

## Observability

Two log streams:

1. **Server-side** (`src/lib/cfWorker/logger.ts`): single-line JSON per call, level-routed via `console.{log,warn,error}`. Events: `call_ok`, `call_non_2xx`, `call_timeout`, `call_network_error`, `call_skipped_no_base_url`. Shape mirrors `src/integrations/*/logger.ts`.
2. **Worker-side** (`cf-worker/src/index.ts`): single-line JSON per request — `cf_worker_request` (success) or `cf_worker_error` (thrown). Logged via `console.log`/`console.error`, captured by Cloudflare's tail / Logflare integration.

Keep cardinality bounded — `path` and `event` are fine to index on, but never log full request bodies or DO state.

## Local development

```bash
cd cf-worker
npm install
npm run dev          # wrangler dev — runs the worker locally on http://127.0.0.1:8787
npm test             # vitest against miniflare (no wrangler dev needed)
npm run typecheck    # tsc --noEmit
```

The server-side helper looks at `process.env.CF_WORKER_BASE_URL`. For local API + local Worker, set `CF_WORKER_BASE_URL=http://127.0.0.1:8787` in the API's `.dev.vars` or `.env.development`.

## CI deploy story

`.github/workflows/cf-worker.yml`:

- **PR**: typecheck + tests. No deploy. No Cloudflare credentials needed.
- **Push to `dev`**: deploys to `autoflow-api-worker-dev`, reachable at `https://autoflow-api-worker-dev.<cf-subdomain>.workers.dev`.
- **Push to `master`**: deploys to `autoflow-api-worker` (production), reachable at the custom domain `https://worker.helloautoflow.com` (configured via `wrangler.toml` `[[env.production.routes]]` with `custom_domain = true`; Cloudflare auto-provisions the DNS record + TLS cert on first prod deploy). Dev stays on its `.workers.dev` URL.
- Secrets via Infisical (`auto-flow-va-pt` project) — same pattern as `dashboard-cloudflare-pages.yml`.

`CF_WORKER_SHARED_SECRET` is set on the Worker via `wrangler secret put --env <env> CF_WORKER_SHARED_SECRET` outside of CI (one-time setup per env, rotated as needed). On the API side, how the secret reaches the Fly runtime differs by env:

- **production** API (`autoflow-api-production`) runs under runtime `infisical run` wrapping (the deploy sets `INFISICAL_PROJECT_ID` + `INFISICAL_TOKEN` on the machine), so every Infisical production secret — including `CF_WORKER_SHARED_SECRET` — is injected automatically. No allowlist edit needed.
- **dev** API (`autoflow-api-dev`) does *not* use runtime Infisical wrapping; the deploy workflow copies an explicit allowlist of vars onto the Fly machine via `flyctl secrets set`. `CF_WORKER_SHARED_SECRET` must therefore be listed in `.github/workflows/deploy-fly-api-dev.yml`'s sync step, or `requireCfWorker` returns **503** ("CF_WORKER_SHARED_SECRET is not configured").

## Adding a new Durable Object

1. Add the class under `cf-worker/src/durable-objects/<Name>.ts`. Mirror `HealthCheck.ts`.
2. Register the binding in `wrangler.toml` — both at the top level and inside each `[env.*]` block.
3. Append a new `[[migrations]]` block to `wrangler.toml` with a new `tag` and `new_classes = ["<Name>DO"]`. Never modify an existing migration block.
4. Add a route entry in `cf-worker/src/index.ts:route()`.
5. Write a vitest test that mirrors `cf-worker/src/__tests__/healthCheck.test.ts`.
6. On the server side, add a typed wrapper in `src/lib/cfWorker/<feature>.ts` that calls `callWorker(...)` — never call `callWorker` directly from feature code.
7. Document the new endpoint in this file under a new heading.

## Adding a new internal route (Worker → API)

1. Add the handler under `src/internal/routes.ts` (or a new sub-router if scope grows).
2. The Worker mints a token with `iss=cf-worker`, `aud=process.env.CF_WORKER_INTERNAL_JWT_AUDIENCE`, `expiresIn` ≤ 30 seconds, signed with `CF_WORKER_SHARED_SECRET`.
3. Worker sends `Authorization: Bearer <jwt>` to `https://${API_BASE_URL}/api/internal/<path>`.
4. `requireCfWorker` verifies the token and attaches `req.cfWorker` for the handler.

## References

- HEL-271 → HEL-306 — RLS rollout (unrelated; for the workspace isolation story see `docs/infra/...` once that's written)
- HEL-310 — this foundation ticket
- HEL-291 through HEL-296 — DO sub-issues that depend on this substrate
