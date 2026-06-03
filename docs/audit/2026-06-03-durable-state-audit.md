# Durable-state audit — in-memory & client-local state surfacing

- **Linear:** [HEL-457](https://linear.app/helloautoflow/issue/HEL-457) (P0 parent) · project _"Durable-state audit: in-memory & client-local state surfacing"_
- **Date:** 2026-06-03
- **Scope:** backend (`src/`) + frontend (`dashboard/src/`)
- **Method:** read the actual code and traced data flow (not inferred from names).

## Why this matters

Production runs the API on `min_machines_running = 2` (`fly.api.production.toml`),
so any state held in a single process's memory is **(a)** lost on deploy/restart and
**(b)** not shared across the two+ machines. Browser-local state
(localStorage/sessionStorage/IndexedDB/cookies) survives a refresh but is invisible
when the same user signs in from another browser or device. Only Postgres/Supabase
(and Redis for ephemeral coordination) is truly durable + cross-instance.

## Two-tier test

1. Survives a backend restart / new server session? (module-level Map/Set/array, in-process cache → **NO**)
2. Survives the same user logging in from a different browser/device? (only component memory or localStorage/sessionStorage/IndexedDB/cookies → **NO**)

Anything failing either test is a finding.

## Severity summary

| ID | Finding | Sev | Tests failed | Ticket |
|----|---------|-----|--------------|--------|
| B1 | Sweep coordinators double-fire across instances | Urgent | multi-instance | [HEL-458](https://linear.app/helloautoflow/issue/HEL-458) |
| B11 | Connector credential stores in-memory (connections lost on restart / cross-instance) | Urgent | restart, multi-instance | [HEL-470](https://linear.app/helloautoflow/issue/HEL-470) |
| B2 | Webhook replay caches in-process (~13 connectors) | High | restart, multi-instance | [HEL-459](https://linear.app/helloautoflow/issue/HEL-459) |
| B10 | OAuth/PKCE handshake state in-memory (callback fails cross-instance) | High | restart, multi-instance | [HEL-471](https://linear.app/helloautoflow/issue/HEL-471) |
| B3 | CRM audit trail in module array | High | restart, multi-instance | [HEL-460](https://linear.app/helloautoflow/issue/HEL-460) |
| B8 | In-memory daily-quota counters bypassed across instances | High | restart, multi-instance | [HEL-467](https://linear.app/helloautoflow/issue/HEL-467) |
| B9 | companyLifecycle reads a stale never-refreshed in-memory mirror | High | multi-instance | [HEL-469](https://linear.app/helloautoflow/issue/HEL-469) |
| F1 | Notification read/mute only in localStorage | Medium | other device | [HEL-461](https://linear.app/helloautoflow/issue/HEL-461) |
| B4 | Admin rate limiter per-process | Low | restart, multi-instance | [HEL-462](https://linear.app/helloautoflow/issue/HEL-462) |
| B5 | agentBus in-process EventEmitter | Low | multi-instance, restart | [HEL-463](https://linear.app/helloautoflow/issue/HEL-463) |
| B6 | presenceStore in-process | Low | multi-instance | [HEL-464](https://linear.app/helloautoflow/issue/HEL-464) |
| B7 | public-status transition memo | Low | multi-instance, restart | [HEL-465](https://linear.app/helloautoflow/issue/HEL-465) |
| F2 | Client-local UI prefs/drafts (roll-up) | Low | other device / refresh | [HEL-466](https://linear.app/helloautoflow/issue/HEL-466) |

---

## BACKEND

### B1 — Sweep coordinators double-fire across API instances (no DB claim/lock) · Urgent

**Files:** `src/engine/approvalResumeCoordinator.ts:7,85-97` (`activeResumes`),
`src/engine/approvalNotificationCoordinator.ts:6,25-60` (`activeDeliveries`),
`src/engine/ticketSlaCoordinator.ts:64`,
`src/promptRoutines/promptRoutineCoordinator.ts:173`; all started in `src/app.ts:23-26`.

Each coordinator is a `setInterval` sweep that reads pending work from Postgres
(correct) but dedupes concurrent processing only via a **process-local `Set`**. No
`SELECT … FOR UPDATE SKIP LOCKED`, no `pg_advisory_lock`, no atomic claim (verified
absent). With 2 prod machines, each runs every coordinator and lists the same pending
rows on the same 2s tick; each checks only its own in-memory Set; both act, then both
write `markSent`/resume.

**Impact:** double workflow-run resume (duplicated LLM spend + duplicated real-world
side effects — CRM writes, emails, tickets); duplicate approval notifications;
duplicate SLA escalations; duplicate routine runs/assignments.

**Fix:** atomic claim (`UPDATE … SET status='processing' WHERE id=$1 AND status='pending' RETURNING`),
or `FOR UPDATE SKIP LOCKED`, or advisory-lock/leader-election, or move delivery onto
BullMQ (Redis single-delivery). Keep the in-process Set only as a fast-path.

### B2 — Webhook replay caches are in-process (systemic, ~13 connectors) · High · security

_Originally scoped to Slack; broadened after Codex's PR review flagged Google Workspace. A full grep shows this is the **entire webhook-replay-protection layer**, not one connector._

**Files** — each declares a module-level `replayCache` (`Map`/`Set`) for signature/delivery-id dedup, evicted by a TTL sweep or `setTimeout`:
`src/integrations/slack/webhook.ts:5`, `src/connectors/google-workspace/webhookRoutes.ts:8` (mounted in prod via `src/app.ts:578`), `src/integrations/stripe/webhook.ts:6`, `src/integrations/hubspot/webhook.ts:6`, `src/integrations/gmail/webhook.ts:10`, `src/integrations/intercom/webhook.ts:6`, `src/integrations/shopify/webhook.ts:6`, `src/integrations/composio/webhook.ts:6`, `src/integrations/teams/webhook.ts:6`, `src/integrations/linear/webhook.ts:6`, `src/integrations/sentry/webhook.ts:6`, `src/integrations/posthog/webhook.ts:6`, `src/integrations/docusign/webhook.ts:6`.

In-memory only → cleared on restart, not shared across machines. A captured, validly-signed webhook can be replayed within the provider's signature window against a *different* Fly machine (or after a deploy) and accepted, because the dedupe set isn't shared. HMAC + timestamp windows still bound the attack, so this is defense-in-depth weakening rather than full bypass — but under the 2-machine prod topology the replay check provides little real protection. **Stripe** (payment events) and the CRM connectors are the highest-impact members.

**Fix:** A single shared `webhookReplayGuard` helper backed by Redis (`SET key NX PX <window>`; reject when the key already exists), adopted by every connector in place of its per-process `replayCache`. Shared across instances, durable across restart. Keep an in-memory fallback for dev/test (`inMemoryAllowed()`).

### B3 — CRM compliance audit trail stored in a module-level array · High · security

**File:** `src/engine/crmAuditLog.ts:68` — `const auditLog: CrmAuditEntry[] = []`
(comment: _"Replace with persistent store for production."_). Appended on every
CRM-bearing LLM/agent step (`src/engine/stepHandlers.ts:262,915`); read via `getAuditLog()`.

In-memory only → restart + multi-instance; also unbounded growth (memory leak). The
ALT-1409 compliance trail's only durable record today is the `console.info` log;
`getAuditLog()` returns a partial, per-process view that resets on deploy.

**Fix:** persist to an append-only Postgres table (e.g. `crm_data_access_log`); drop or
hard-bound the in-memory array.

### B8 — In-memory daily-quota counters bypassed across instances · High · security

_Surfaced by Codex's PR review; missed by the initial sweep because both declarations carry an `// allowlist:` comment._

**Files:**
- `src/hostedFreeModels/usageStore.ts:31` — `const usageByWorkspace = new Map<string, UsageEntry>()`, enforcing a 50K-token/day cap that protects the **shared** hosted-free API keys (`GROQ_API_KEY` / `OPENCODE_ZEN_API_KEY`).
- `src/agents/agentMemoryRoutes.ts:17` — `const semanticSearchUsage = new Map<string, number>()`, enforcing per-tier daily semantic-search limits (flow 100 / automate 1000).

In-memory only → restart resets the counters mid-day, and on 2 prod machines each instance keeps its own counter, so the effective cap is ~N×. For the hosted-free cap this directly weakens protection of a shared paid API key (a single workspace can drain roughly double the intended budget, more after a deploy). For semantic search, paid-tier rate limits are similarly leaky.

**Fix:** Move both counters to a shared, atomic store — Redis `INCR` + `EXPIRE` to UTC midnight (key `hostedfree:{workspaceId}:{dayKey}` / `semsearch:{workspaceId}:{dayKey}`), or a Postgres daily-usage table with an atomic upsert — behind the existing function signatures (`assertWithinHostedFreeCap` / `recordHostedFreeTokens`, semantic-search limit check). Keep the in-memory impl as the dev/test fallback.

### B4 — Admin-console rate limiter is per-process in-memory · Low · security

**File:** `src/adminConsole/rateLimit.ts:91` — `const store = new Map<string, Entry>()`
(_"per machine; resets on restart by design"_). Effective ceiling is N×limit across N
machines and resets on deploy. Staff-only surface, hence Low.

**Fix:** route through the Cloudflare Durable Object limiter (`src/lib/cfWorker/rateLimiter.ts`) or Redis.

### B5 — agentBus is an in-process EventEmitter + per-run log · Low · refactor

**File:** `src/engine/agentBus.ts:14-57` — `EventEmitter` + `log: AgentMessage[]` per run,
registry `Map`. Multi-instance: a run's manager↔worker steps must share a process.
Low today (runs pinned to one worker); latent scaling bug.

**Fix:** Redis pub/sub backbone behind the same publish/subscribe/drain API (documented upgrade path).

### B6 — Workflow presence store is in-process · Low · refactor

**File:** `src/workflows/presenceStore.ts:72-145` — `byWorkflow`/`listenersByWorkflow`
Maps, 30s TTL. Multi-instance: users on different machines don't see each other.
Best-effort awareness, hence Low.

**Fix:** Redis-backed adapter behind the existing `PresenceStore` interface.

### B7 — Public-status transition memo is per-process · Low

**File:** `src/landing/publicStatusService.ts:158-163` — `const lastLevelByComponent = {}`
detects transitions before writing `public_status_events`. Multi-instance → duplicate
timeline rows; cold start → missed transition. Source of truth (the table) is durable.

**Fix:** derive "changed since last" from the table's last row, or single-writer.

### B9 — companyLifecycleStore serves a stale, never-refreshed in-memory mirror · High · security

_Surfaced by Codex's PR review; this was **mis-classified as a NOT-finding** in the first pass — it persists to Postgres, but its **reads** come from an in-process cache that never refreshes._

**File:** `src/controlPlane/companyLifecycleStore.ts:48-51, 145-153, 203-217`. The store keeps in-memory `lifecycleStates` / `lifecycleAudit` `Map`s, populated **once** by `ensurePreloaded()` (the `preloadPromise` is memoized for the life of the process and never re-run). `getState()` / `isPaused()` / `listAudit()` read **only** those maps; `applyAction()` writes to Postgres **and** the local map — but only in the process that handled the request.

**Tests failed:** multi-instance (the writer persists durably, but other instances never see the change).

**Impact (High):** On the 2-machine prod API, pausing a company on instance A updates A's map + Postgres, but instance B (which preloaded the prior `active` state) keeps returning `isPaused() === false` **forever** (until B restarts). `startAgentExecution()` / `recordHeartbeat()` gates on B therefore keep **executing agents for a company that was paused** — defeating a control-plane safety/billing stop across roughly half of traffic, with continued spend.

**Fix:** Read lifecycle state from Postgres on access (it's a tiny, indexed lookup), or add a short TTL / pub-sub invalidation to the cache so a pause on one instance is visible on the others within seconds. The simplest correct option is to drop the read cache and query `company_lifecycle` directly in `getState()`/`listAudit()`. **Also verify `src/controlPlane/controlPlaneStore.ts`** for the same preload-once read-cache pattern (it has a hydration path) and fold it in if present.

### B11 — Legacy connector credential stores are in-memory · Urgent · security

_Surfaced by Codex's PR review; the integrations layer was under-covered in the first pass._

**Files:** `src/integrations/{linear,teams,shopify,docusign,posthog,intercom}/credentialStore.ts` — each keeps credentials in a module-level `store` `Map`, never persisted to Postgres (verified: zero `pool.query`/`queryPostgres`/Supabase references). Routers mounted in prod under `/api/integrations/*` (`src/app.ts:853-862`).

**Tests failed:** restart + multi-instance.

**Impact (breaks the MVP "connect tools" loop):** a completed Linear/Teams/Shopify/DocuSign/PostHog/Intercom connection (OAuth tokens / API keys) is **lost on the next deploy/restart** and **invisible on the other Fly machine**, so ~half of subsequent requests act as "not connected" and connector steps fail intermittently. The at-rest key also falls back to `randomBytes(32)` when `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` is unset, so it's ephemeral per process and differs per machine.

**Fix:** Persist credentials to Postgres, encrypted with a stable key (reuse `src/secrets/keyVersionedSecretVault` / `src/controlPlane/secretsRepository`), keyed by workspace + connector + credential id, behind the existing `*CredentialStore` interfaces; in-memory only under `inMemoryAllowed()`. Audit every connector `credentialStore.ts` (cf. `google-workspace/credentialsStore.ts`, which already persists) and require the encryption key outside dev/test.

### B10 — OAuth/PKCE handshake state is in-memory · High · security

_Surfaced by Codex's PR review._

**Files:** `src/integrations/authAdapters.ts:52-53` — `const pkceStateMap = new Map<string, PkceState>()` (10-min TTL, purged in-process); per-provider flows use the same process-local `stateStore` pattern (Slack/Intercom, Apollo/HubSpot). `/authorize` + public callbacks mounted in prod.

**Tests failed:** restart + multi-instance.

**Impact:** authorize runs on machine A (stores `state` in A's map); the provider redirects to the callback, which the LB routes to either machine → ~50% chance it lands on B, which has no record → **"invalid state"** even though the flow just started (a deploy within 10 min does the same). OAuth connector setup fails intermittently.

**Fix:** Store handshake `state`/`code_verifier` in a shared TTL store (Redis `SET state … EX 600`, or a Postgres `oauth_handshakes` table cleaned on read/expiry), read back in the callback on any instance; in-memory only under `inMemoryAllowed()`. `code_verifier`/`clientSecret` are sensitive — encrypt at rest if persisted.

### Backend — verified NOT findings

- Main API rate limiter → Cloudflare Durable Object (`src/lib/cfWorker/rateLimiter.ts`). Distributed + durable.
- Agent trace / workspace stream → Redis pub/sub in prod (`src/engine/agentTrace/tracePublisher.ts:68-80`, `streamPublisher.ts`); in-memory subscriber maps are dev/test fallback only.
- `runStore`, `approvalStore`, `approvalNotificationStore`, `agentMemoryStore`, `notificationStore`, `ticketStore` → Postgres in prod; `new Map()` fallback only when `AUTOFLOW_ALLOW_INMEMORY=true` (dev/test) — else they throw without `DATABASE_URL` (`src/db/postgres.ts:28`). _(These write through to AND read from Postgres each call — unlike `companyLifecycleStore`, see B9.)_
- ⚠️ `companyLifecycleStore` — **moved to a finding (B9)**: it persists to Postgres but serves reads from a never-refreshed in-memory mirror. `controlPlaneStore` should be re-verified for the same preload-once read-cache pattern.
- `src/admin/staffAuth.ts:29` `cachedStaffIds` → derived from the `AUTOFLOW_STAFF_USER_IDS` env var (immutable config).
- `src/worker.ts:335` `setTimeout` → one-shot startup delay for `syncRepeatableJobs`.

---

## FRONTEND

### F1 — Notification read-state & muted categories only in localStorage · Medium

**File:** `dashboard/src/hooks/useNotifications.ts:67-113` — keys
`af2.notifications.read.v1.<workspaceId>` and `af2.notifications.muted.v1.<workspaceId>`
(_"no backend schema change"_); also `dashboard/src/components/notifications/NotificationCenter.tsx`.

Browser-local → survives refresh, lost on another browser/device. Read/dismiss/mute
state doesn't follow a multi-device operator (sources are server-derived, so no data loss).

**Fix:** persist read + mute state server-side (per user+workspace), sync via API; keep localStorage as cache.

### F2 — Client-local UI preferences & unsaved drafts don't sync across devices · Low (roll-up)

- Onboarding banner/tour dismissal — `dashboard/src/components/OnboardingBanner.tsx:48,261`, `OnboardingTour.tsx:77,131`.
- Upgrade banner dismissal — `dashboard/src/components/UpgradeBanner.tsx:255,440`.
- Home filters — `dashboard/src/hooks/useHomeFilters.ts:72,108`.
- RunTray pose — `dashboard/src/components/RunTray.tsx:20,30`.
- Command palette recent history — `dashboard/src/components/CommandPalette.tsx`.
- Unsaved in-progress form drafts (lost on refresh): `dashboard/src/pages/Hire.tsx:89-90,132`; plan edits `dashboard/src/pages/HiringPlanReview.tsx:260,263`. The persisted mission + plan ARE server-side; only un-submitted edits are ephemeral.

**Fix:** move onboarding-completion + filters to a per-user settings row; optionally autosave drafts. Several items are fine as client-local — ticket exists to decide deliberately.

### Frontend — verified NOT findings

- Supabase auth token in localStorage (`dashboard/src/auth/supabaseAuth.ts:105-121`, `persistSession:true`) — standard; session is server-issued, a new device logs in fresh, so signed-in state IS reconstructable from the server. PKCE verifier in localStorage is intentional (cross-tab magic-link/recovery).
- `dashboard/src/auth/authStorage.ts` sessionStorage user → cache of server data.
- `dashboard/src/auth/useAuthCooldown.ts` sessionStorage countdown → intra-tab UX only.
- Core product loop is server-persisted: `createMission` POSTs to `/api/missions`; the hiring plan is generated server-side and re-fetched by URL params in `HiringPlanReview` → reconstructable on a new device.
- `dashboard/src/hooks/useInFlightRuns.ts` — explicitly server-backed ("server, not localStorage, so it travels").
