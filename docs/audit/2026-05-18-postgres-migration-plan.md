# Postgres Migration Plan — finish the in-memory → canonical sweep

Date: 2026-05-18
Author: Claude (Opus 4.7)
Builds on: `docs/audit/2026-05-18-comparison.md` Tier 4

## Why this doc exists

After DASH-41..46 shipped today, the architectural picture is:
- **Canonical Postgres is now the live read+write path for**: missions, hiring plans, workflows, runs, step_results, activity_events, budgets, entitlements (read), wake_events, connector_connections, user profile, memory_entries, approval_notifications, and the full HITL suite (schedules, checkpoints, artifact_comments, ask_ceo_requests, hitl_notifications).
- **In-memory is still authoritative for**: subscriptions, encrypted integration credentials, MCP server registry, webhook relay subscriptions+events. These are the remaining "lose data on restart" bombs.
- **In-memory is hybrid (Postgres + Map mirror) for**: controlPlaneStore (the biggest), ticketStore, approvalStore, observability, notifications, knowledge, reporting, plus several smaller stores. These read from both; restart drops the in-memory layer but the canonical row survives.
- **In-memory should stay** for ~30 ephemeral caches (OAuth/PKCE state, webhook replay dedup, agent bus, LLM provider registry, etc.) — they are process-local by design.

This plan walks the remaining work in dependency order with PR-sized scope per ticket.

---

## Inventory: every in-memory `Map<>` in `src/`

105 declarations total. Grouped by what to do.

### Category A — Already hybrid, needs cleanup (12 stores)

These read from both stores. The pattern is the same shape Claude+Codex flagged in the audit (DASH-36 / DASH-40 / DASH-43): the row exists in Postgres, but if a route reads the Map first and forgets to fall back, it silently 404s post-restart. Cleanup = audit each `getX()` / `listX()` for the read-Postgres-on-miss pattern, and where the in-memory mirror isn't load-bearing for performance, **drop it entirely** and read Postgres on every call.

| Store | Maps | PG refs | Risk if left as-is | Cleanup PR size |
| --- | --- | --- | --- | --- |
| `controlPlane/controlPlaneStore.ts` | 15 | 27 | High — biggest legacy store, every route handler reads Map first | XL |
| `tickets/ticketStore.ts` | 4 | 24 | Low — already DB-first, Maps are a fallback path | S |
| `engine/approvalStore.ts` | 2 | 12 | Medium — drives the Approvals page | M |
| `observability/store.ts` | 4 | 12 | Low — event stream, lossy is acceptable | S |
| `notifications/store.ts` | 3 | 9 | Medium — user notification prefs | M |
| `tickets/ticketSlaStore.ts` | 1 | 12 | Low | S |
| `tickets/ticketSlaPolicyStore.ts` | 1 | 9 | Low | S |
| `tickets/ticketNotificationStore.ts` | 1 | 9 | Low | S |
| `knowledge/knowledgeStore.ts` | 4 | 10 | Medium — three-layer memory live path | M |
| `approvals/policyStore.ts` | 1 | 7 | Low | S |
| `templates/importedTemplateStore.ts` | 1 | 6 | Low | S |
| `controlPlane/companyLifecycleStore.ts` | 2 | 4 | Medium — pause/resume signal | S |
| `reporting/reportStore.ts` | 1 | 4 | Low — already orphan (Tier 2) | S |

### Category B — No Postgres at all, customer data (5 stores) — **MUST migrate**

These are the data-loss bombs.

| Store | What it holds | Why this hurts | Migration shape |
| --- | --- | --- | --- |
| `billing/subscriptionStore.ts` | Stripe subscriptions → access levels | Stripe webhook lands here; restart = stale entitlements until the next webhook | New `subscriptions_canonical` table OR finally use the existing `subscriptions` table (migration 028 already exists) |
| `billing/entitlements.ts` | Derived plan limits per workspace | Workspace upgrades vanish on restart until subscriptions hydrate | Read-through compute from canonical `entitlements` table (migration 025) |
| `integrations/integrationCredentialStore.ts` | Encrypted OAuth tokens per integration | OAuth-connected integrations stop working until users re-auth | Use existing `connector_credentials` table (migration 006) |
| `mcp/mcpStore.ts` | User-registered MCP server URLs | User-added MCPs disappear on restart | New `mcp_servers` table |
| `integrations/webhookRelay.ts` | Webhook subscriptions + per-event log | Subscriptions vanish; in-flight events lost | New `webhook_subscriptions` + `relayed_events` tables |

### Category B+ — `agentMemoryStore` (special case)

`src/agents/agentMemoryStore.ts` has four Maps but ALSO ad-hoc `CREATE TABLE` calls inside the module (lines 506-532). The Maps are wired to Postgres but the schema lives in code, not in `migrations/`. Cleanup: move the DDL into a proper migration, drop the in-code `CREATE TABLE` runtime calls.

### Category C — Process-local caches (KEEP as Map) — 70+ instances

Don't touch these:

- **OAuth/PKCE state stores** (16): `apollo/oauthStateStore.ts`, `docusign/pkceStore.ts`, `gmail/pkceStore.ts`, `hubspot/oauthStateStore.ts`, `intercom/pkceStore.ts`, `linear/pkceStore.ts`, `posthog/pkceStore.ts`, `sentry/pkceStore.ts`, `shopify/pkceStore.ts`, `slack/pkceStore.ts`, `stripe/oauthStateStore.ts`, `teams/pkceStore.ts`, `agent-catalog/pkceStore.ts`, `authAdapters.ts:pkceStateMap`, plus connector-specific OAuth states. Short-lived CSRF state, callback completes in seconds. Redis would be the right home (single-process == single-machine restart breaks the OAuth flow), but that's a `Phase D` Upstash move — not a Postgres job.
- **Webhook replay caches** (12): `composio/webhook.ts:replayCache`, etc. Dedup nonces with TTL; survive process restart is nice-to-have not essential.
- **Process-internal**: `engine/queue.ts:chains|drains|enqueueWrites` (Promise chains for in-process async), `engine/agentBus.ts:registry` (per-process pub/sub), `engine/WorkflowEngine.ts:actionRegistry` (action handlers — code, not state), `runStore.ts:memoryStore` (runs are persisted; this is a tests-only fallback), `auth/supabaseAuth.ts:remoteJwksCache` (cache of JWKS — re-fetched on cache miss).
- **Rolling counters**: `hostedFreeModels/usageStore.ts:usageByWorkspace`, `integrations/shared/tier1Contract.ts:tier1HealthMemory`, `integrations/shared/credentialRegistry.ts:registryBuckets`, `llmConfig/tierRouter.ts:inMemoryWorkspaceMatrices|inMemoryAgentOverrides`, `agents/agentMemoryRoutes.ts:semanticSearchUsage`, `connectors/google-workspace/webhookRoutes.ts:replayCache`.
- **Configuration mirrors**: `auth/socialAuthStrategies.ts:providerConfigurationErrors`, `agent-catalog/credentialStore.ts:store` (uses CentralCredentialStore — credentialRegistry pattern).

### Schema orphans to drop (4)

From the audit:
- `agent_assignments` (migration 031) — zero refs.
- `agent_memory_sharing_policies`, `agent_memory_workspace_shares` (migration 016) — replaced by HEL-86 three-layer memory.
- `icp_profiles`, `email_sends`, `campaigns` (migration 001) — pre-canonical outreach, zero refs.
- `llm_configs` (migration 005) — replaced by CentralCredentialStore via `connector_credentials`.

---

## Phased plan

### Phase 1 — Stop the bleeding (Category B, 5 PRs)

The five customer-data stores with NO Postgres at all. Each PR follows the same shape as DASH-44/-45: convert methods to async, write-through to canonical table, in-memory branch only when `inMemoryAllowed()`.

| # | PR | Tables touched | Migration needed? | Effort |
| --- | --- | --- | --- | --- |
| **DASH-47** | `subscriptionStore` → Postgres | `subscriptions` (migration 028 exists) | No | M |
| **DASH-48** | `entitlements` → Postgres | `entitlements` (migration 025 exists) | No | S |
| **DASH-49** | `integrationCredentialStore` → Postgres | `connector_credentials` (migration 006 exists) | No, but verify encryption envelope matches | M |
| **DASH-50** | `mcpStore` → Postgres | NEW `mcp_servers` table | Yes — new migration | M |
| **DASH-51** | `webhookRelay` → Postgres | NEW `webhook_subscriptions` + `webhook_relayed_events` tables | Yes — new migration | M |

**Sequencing:** DASH-47 → DASH-48 (entitlements derives from subscriptions). Then 49/50/51 in parallel (independent).

**Risk for each:** medium. Each store has its own route handlers + tests; the work is mechanical but the surface area is real. Watch for callers that depend on synchronous return shapes.

### Phase 2 — Schema cleanup (1 PR)

| # | PR | Scope |
| --- | --- | --- |
| **DASH-52** | Drop the four orphan schemas | Single migration: `DROP TABLE IF EXISTS agent_assignments, agent_memory_sharing_policies, agent_memory_workspace_shares, icp_profiles, email_sends, campaigns, llm_configs`. Document in commit body why each is safe to drop (zero code refs across `src/` + git history pointer for any historical data). |

**Risk:** low. All seven tables are confirmed unused. Backup is git history if we ever need to recreate.

### Phase 3 — Hybrid cleanup (Category A, 12 PRs)

For each hybrid store, audit the read paths. Two outcomes per method:
1. **Already reads Postgres on memory miss** → no-op (good).
2. **Reads memory only** → either drop the memory mirror entirely (preferred) OR add a Postgres fallback (DASH-27/-40 pattern).

Per-store PRs in this order (smallest blast radius first):

| # | PR | Store | Why first/last |
| --- | --- | --- | --- |
| **DASH-53** | `reporting/reportStore` cleanup | Already orphan per audit Tier 2 — easiest win |
| **DASH-54** | `templates/importedTemplateStore` cleanup | Small, isolated |
| **DASH-55** | `tickets/ticketSlaStore` + `ticketSlaPolicyStore` + `ticketNotificationStore` | Cluster: same surface area, share the same migration pattern |
| **DASH-56** | `approvals/policyStore` cleanup | Small, isolated |
| **DASH-57** | `tickets/ticketStore` Map drop | Already DB-first; can probably just delete the Map mirror |
| **DASH-58** | `engine/approvalStore` Map drop | Cousin of DASH-43; small |
| **DASH-59** | `controlPlane/companyLifecycleStore` Map drop | Pause/resume signal; needs careful test |
| **DASH-60** | `observability/store` cleanup | Lossy is OK but the subscriber Map is process-local pub/sub — KEEP that, drop the events mirror |
| **DASH-61** | `notifications/store` cleanup | User notification preferences — must persist |
| **DASH-62** | `knowledge/knowledgeStore` cleanup | Three-layer memory; carefully done because the chunk-embedding Map is a performance cache (the only legitimate caching one in the list) |
| **DASH-63** | `agents/agentMemoryStore` schema-to-migration move | Move the in-code `CREATE TABLE` calls into a proper `0NN_agent_memory_*.sql` migration |
| **DASH-64** | `controlPlane/controlPlaneStore` Map drop sweep | **XL.** The hardest. Suggest breaking into sub-PRs by entity: teams, agents, executions, tasks, heartbeats, spend, budget alerts — one sub-PR per Map. |

DASH-64 might be 5-7 separate PRs in practice. Suggest splitting AFTER landing the easier ones first, so the engineering team gets a feel for the conversion pattern.

### Phase 4 — Belt and suspenders (1 PR)

| # | PR | Scope |
| --- | --- | --- |
| **DASH-65** | CI grep guard for new `new Map<` declarations | A simple `grep -rE 'new Map<' src/` in CI that fails if a new top-level Map is added without an `// allowlist: <reason>` comment. Prevents the dual-store pattern from sneaking back in. |

---

## What this plan deliberately leaves alone

- **PKCE / OAuth state stores** (16). The right move for these is Upstash Redis (so OAuth callbacks work across multi-machine Fly), not Postgres. Tracked separately as a Phase D / DASH-7X bundle once Upstash is wired into the worker (DASH-37).
- **Webhook replay caches** (12). Same story — Upstash, not Postgres.
- **Process registries** (`actionRegistry`, `agentBus`, `WorkflowEngine` internals). These are code, not data. Postgres makes no sense.

---

## Risk register

| Risk | Mitigation |
| --- | --- |
| Phase 3 hybrid cleanup quietly breaks a route handler that reads Map first without an explicit Postgres fallback. | Each PR includes a Vitest assertion that the route's response shape survives a `pool.query` mock that returns empty rows (forces the Postgres path). |
| `controlPlaneStore` (DASH-64) is too large to land in one PR. | Pre-commit: split into one PR per Map entity. Land in dependency order (teams → agents → executions → tasks → heartbeats → spend → budgets). |
| Dropping the legacy outreach tables (Phase 2) deletes data someone forgot about. | `pg_dump` the seven tables to a one-off backup file kept in `infra/backups/2026-05-pre-orphan-cleanup.sql` before merging DASH-52. |
| Phase 1 stores have callers that depend on synchronous return shapes. | Each Phase 1 PR runs a TypeScript-level diff check first (the compiler will catch every sync→async signature change). Manual smoke after merge on dev. |

---

## Effort summary

| Phase | PRs | Approx effort |
| --- | --- | --- |
| Phase 1 — Customer data | 5 | M each (~1 PR/day) |
| Phase 2 — Schema cleanup | 1 | XS |
| Phase 3 — Hybrid cleanup | 12-18 | Varies; mostly S/M, DASH-64 is XL split into sub-PRs |
| Phase 4 — Guard | 1 | XS |
| **Total** | ~20-25 | Roughly 2-3 weeks of focused work if sequential, 1-2 weeks if parallelized across two engineers |

---

## What we do NOT need before starting

- No new migration tooling. The existing boot-time runner at `src/db/sqlMigrations.ts` (single source of truth as of DASH-39) handles everything.
- No data migration scripts for Phase 1. The existing in-memory writes happen per-process; once the new Postgres writes go live, future data lands canonical. Stripe webhook will re-emit subscription state within hours of merge.
- No backfill for Phase 2. The dropped tables have zero data.
- No infra changes. All Postgres tables already exist or are added by inline migrations.

---

## Recommended kickoff sequence

If you want to start tomorrow:
1. **DASH-47** (subscriptions) — high impact, small surface, unblocks DASH-48.
2. **DASH-49** (integration credentials) — biggest customer pain (OAuth dropping on every deploy).
3. **DASH-52** (schema drops) — get the easy win in.
4. Pick the next PR based on whichever in-memory store has caused the most recent production incident.

I'll write whichever you authorize next.
