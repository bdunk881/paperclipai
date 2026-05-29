# cf-worker

The AutoFlow Cloudflare Worker. Hosts Durable Objects called from the Fly-hosted Express API.

Quick start:

```bash
cd cf-worker
npm install
npm test            # vitest against miniflare (no auth, no network)
npm run dev         # wrangler dev — local Worker on http://127.0.0.1:8787
npm run typecheck   # tsc --noEmit
```

Deploy story, fallback policy, naming conventions, and "how to add a new DO" live in `docs/infra/durable-objects.md`. Read that first.

## Current DO inventory

| Class | Binding | Purpose |
|---|---|---|
| `HealthCheckDO` | `HEALTH_CHECK` | Smoke target. Singleton instance reached at `GET /__health`. |

## Layout

```
cf-worker/
├── package.json
├── package-lock.json
├── tsconfig.json
├── wrangler.toml         # bindings + per-env config (dev / production)
├── vitest.config.ts      # @cloudflare/vitest-pool-workers
└── src/
    ├── index.ts          # ExportedHandler — routes to DOs
    ├── durable-objects/
    │   └── HealthCheck.ts
    └── __tests__/
        └── healthCheck.test.ts
```

## Secrets

`CF_WORKER_SHARED_SECRET` is set per env via `wrangler secret put --env <env> CF_WORKER_SHARED_SECRET` (one-time outside CI). It signs JWTs the Worker mints back to the API for `/api/internal/*` routes.

## URLs

| Env | Worker URL |
|---|---|
| dev | `https://autoflow-api-worker-dev.<cf-subdomain>.workers.dev` |
| production | `https://worker.helloautoflow.com` (custom domain — see `wrangler.toml` `[[env.production.routes]]`) |

Health check on either env: `GET /__health` → `{ ok, ts, instanceId }` from `HealthCheckDO`.
