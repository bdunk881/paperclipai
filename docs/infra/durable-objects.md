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
| `src/lib/cfWorker/rateLimiter.ts` | Typed server helper for `RateLimiterDO` consume/refund calls. Express middleware imports this, not `callWorker` directly. |
| `src/middleware/requireCfWorker.ts` | Express middleware that verifies a Worker→server JWT. Mounted at `/api/internal/*`. |
| `src/middleware/rateLimit.ts` | Express middleware that preserves the API's current limit windows while delegating atomic decisions to `RateLimiterDO`. |
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

## RateLimiterDO (HEL-291)

`RateLimiterDO` replaces the API's old process-local `express-rate-limit`
counters. It is the first production coordination DO and establishes the
pattern later HEL-292 through HEL-296 work should reuse.

### Endpoint

`POST /rate-limit/consume`

```json
{
  "scope": "workspace",
  "key": "workspace:abc-123",
  "limit": 100,
  "windowMs": 60000
}
```

Response:

```json
{
  "allowed": true,
  "remaining": 99,
  "retryAfterMs": 0
}
```

The Worker derives the DO instance name as `"{scope}::{key}"` and resolves it
with `env.RATE_LIMITER.idFromName(...)`. The DO stores sliding-window hit
timestamps in SQLite and keeps a hot in-memory copy for repeated requests while
the instance is warm. The persisted SQLite rows are the source of truth after
hibernation or eviction.

`POST /rate-limit/refund` accepts the same body and removes the newest hit for
that key. The Express middleware uses this only for legacy
`skipFailedRequests` compatibility on mutation endpoints where failed upstream
requests should not consume the customer's limited budget.

### Server usage

Feature code should call the typed helper:

```ts
const decision = await rateLimit({
  scope: "workspace",
  key: `workspace:${workspaceId}`,
  limit: 100,
  windowMs: 60_000,
});
```

Express routes should use `createDurableObjectRateLimiter(...)` from
`src/middleware/rateLimit.ts`. The middleware preserves the existing API
contract: status `429`, body `{ "error": "Too Many Requests" }`, a
`Retry-After` header, and standard `RateLimit-*` headers.

### Fallback policy

Rate limiting is fail-open by default. If the Worker returns non-2xx, times out
after the default 100ms, or is unreachable, `src/lib/cfWorker/client.ts` logs a
structured warning and the middleware allows the request through. Callers with a
security-sensitive threat model can pass `onFailure: "fail-closed"`; the typed
helper converts Worker failures into a denied decision.

### Observability

Server-side call logs come from `src/lib/cfWorker/logger.ts` with
`metadata.feature = "rate_limiter"` and a bounded `scope` tag. Worker-side
request logs come from `cf-worker/src/index.ts`; the DO additionally logs
`rate_limiter_consume` with class/method/outcome, limit/window, remaining
tokens, and duration. Do not add raw request bodies or full user/API keys to
logs.

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
3. Append a new `[[migrations]]` block to `wrangler.toml` with a new `tag`. Use `new_classes = ["<Name>DO"]` for non-SQL DOs and `new_sqlite_classes = ["<Name>DO"]` for DOs that call `ctx.storage.sql`. Never modify an existing migration block.
4. Add a route entry in `cf-worker/src/index.ts:route()`.
5. Write a vitest test that mirrors `cf-worker/src/__tests__/healthCheck.test.ts`.
6. On the server side, add a typed wrapper in `src/lib/cfWorker/<feature>.ts` that calls `callWorker(...)` — never call `callWorker` directly from feature code.
7. Document the new endpoint in this file under a new heading.

## Adding a new internal route (Worker → API)

1. Add the handler under `src/internal/routes.ts` (or a new sub-router if scope grows).
2. The Worker mints a token with `iss=cf-worker`, `aud=process.env.CF_WORKER_INTERNAL_JWT_AUDIENCE`, `expiresIn` ≤ 30 seconds, signed with `CF_WORKER_SHARED_SECRET`.
3. Worker sends `Authorization: Bearer <jwt>` to `https://${API_BASE_URL}/api/internal/<path>`.
4. `requireCfWorker` verifies the token and attaches `req.cfWorker` for the handler.

## Yjs wire contract (WorkflowDocDO target — HEL-794)

The workflow-builder collaborative doc syncs over the **y-protocols** wire (sync step1/2 + awareness), not the `y-websocket` wrapper version. As of HEL-794 the client (`dashboard/`) and server (`src/`) resolve to an **identical wire stack**, verified from both lockfiles:

| Package | Client (dashboard) | Server (src) | Role |
|---|---|---|---|
| `yjs` | 13.6.31 | 13.6.31 | CRDT doc + update encoding |
| `y-protocols` | 1.0.7 | 1.0.7 | **the wire** (sync + awareness framing) |
| `lib0` | 0.2.117 | 0.2.117 | varint / encoding primitives |
| `y-websocket` | 3.0.0 | 2.1.0 | transport wrapper (sits *above* the wire) |

The `y-websocket` **major differs** (3.x client / 2.x server) but is **wire-compatible**: both wrap the same `y-protocols@1.0.7` / `yjs@13.6.31`, and name-collaboration has run on this pairing without sync errors. We deliberately do **not** bump the server's `y-websocket` to 3.x — Sub-phase B (HEL-803) retires the in-process `y-websocket` room entirely in favour of the hand-rolled `WorkflowDocDO`, so the server wrapper version is moot.

**`WorkflowDocDO` (HEL-800) MUST target this wire** — `y-protocols@1.0.7`, `yjs@13.6.31`, `lib0@0.2.117` — so an unmodified `y-websocket@3` `WebsocketProvider` client keeps syncing after the host-swap. Pin these in `cf-worker/package.json`.

## WorkflowDocDO (HEL-800, Sub-phase B3)

`WorkflowDocDO` (`cf-worker/src/durable-objects/WorkflowDoc.ts`) is the hibernatable WebSocket host for one workflow's collaborative builder graph — the strangler replacement for the in-process `y-websocket` room (`src/workflows/ydoc/workflowYDocRoom.ts`). One instance per `workflow::<id>`.

### Route

`GET /workflows/<uuid>/ydoc` (WebSocket upgrade) → `env.WORKFLOW_DOC.idFromName("workflow::<id>")`. The DO replies `101` with the client socket and runs the y-sync handshake.

> ⚠ **Not authenticated yet.** B3 ships the transport only. Edge auth (verify the user's Supabase token + call `POST /api/internal/ydoc/authorize`, from B2) lands in **B4 (HEL-801)**, and no client points at this route until **B6 (HEL-803)**. Until B4 the route is **gated to non-production** (`env.ENVIRONMENT === "production"` → 404) so the prod Worker never exposes an unauthenticated doc socket; the binding + migration still apply on prod so the host-swap is a config-only flip later. Dev has no real customer data and is where the two-client smoke runs.

### Wire framing

Hand-rolled from `y-protocols` + `lib0` (the in-process room used `y-websocket/bin/utils`, a Node helper that can't run in a Worker). Message types match y-websocket: `0 = sync` (`readSyncMessage` / `writeSyncStep1` / `writeUpdate`), `1 = awareness`. On connect the DO sends sync step1; inbound updates are applied to the in-memory `Y.Doc` and the resulting delta is fanned out to the other sockets via `ctx.getWebSockets()`.

### Hibernation + the keepalive spike (acceptance gate)

Sockets are accepted with `ctx.acceptWebSocket` so the DO can shed memory while connections stay open. The mandatory spike question was: **does an unmodified `y-websocket` client survive a hibernation cycle without a 1006 idle drop?**

**Finding: no — not on its own.** The `y-websocket` client (`messageReconnectTimeout = 30_000`, checked every 3s) closes + reconnects if it receives **no message for 30s**. Only `onmessage` data resets its timer — WebSocket protocol pings do **not** (verified in `dashboard/node_modules/y-websocket/src/y-websocket.js`; the client's own comment: *"no message received in a long time — not even your own awareness updates"*). And `setWebSocketAutoResponse('ping','pong')` does **not** help, because y-websocket sends no such application-level message. So a hibernated, idle DO that sends nothing would make every client reconnect every ~30s.

**Mitigation (implemented): a keepalive alarm.** A self-rescheduling alarm sends a sync step1 to all `getWebSockets()` every `KEEPALIVE_INTERVAL_MS = 20_000` (≈10s margin under the 30s client timeout) **while clients are connected**, which resets the client timer → no 1006 churn. The alarm is **cleared on last disconnect** (`webSocketClose` → `deleteAlarm`), so an empty DO still goes fully idle/evicts. This is the documented trade-off from "When to use a Durable Object": a recurring keepalive means the DO wakes ~every 20s during an active session (hibernating in the gaps) rather than sleeping deeply — connection stability is worth more than the marginal idle saving here. A future optimization (B6) could raise the client's `messageReconnectTimeout` to widen the keepalive interval and deepen hibernation.

### Persistence

- **DO-local (B3):** the full doc state (`Y.encodeStateAsUpdate`) is mirrored to `ctx.storage` after each applied update (coalesced) and rehydrated in the constructor under `blockConcurrencyWhile` — so a hibernation wake / eviction never serves an empty doc that a late message would clobber.
- **Postgres mirror (B5, HEL-802):** a dirty-gated single-shot alarm will push snapshots to the durable store via the B2 internal API (`POST /api/internal/workflows/:id/ydoc-snapshot`) and cold-start-hydrate from it (`GET`), so state survives DO *deletion*/relocation and feeds other readers.

### Awareness (presence)

Relayed verbatim to peers, **never persisted**, with **no server-side `Awareness` instance** — a server `Awareness` runs a refresh `setInterval` that would keep the DO from hibernating, and presence is authoritatively carried on SSE. Departed cursors expire via each remaining client's own awareness `outdatedTime` (~30s).

### Tests

`cf-worker/src/__tests__/workflowDoc.test.ts` drives the DO with a minimal real-`Y.Doc` y-protocols client over an actual `SELF.fetch` WebSocket: 426/404 routing, the two-client bidirectional relay, late-joiner hydration via the handshake, DO-local persistence (rehydrate a doc from the stored bytes), the keepalive alarm tick, and alarm-cleared-on-last-disconnect. (Gotcha: a test client must set `ws.binaryType = "arraybuffer"` — the real y-websocket client does this; without it binary frames arrive as Blobs and decode to empty arrays.)

## References

- HEL-271 → HEL-306 — RLS rollout (unrelated; for the workspace isolation story see `docs/infra/...` once that's written)
- HEL-310 — this foundation ticket
- HEL-291 through HEL-296 — DO sub-issues that depend on this substrate
