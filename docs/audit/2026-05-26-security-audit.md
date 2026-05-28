# Security audit — 2026-05-26

Static analysis audit of the AutoFlow monorepo (`src/`, `dashboard/`, `landing/`, Docker/CI, npm dependencies). No live penetration testing was performed.

**Auditor:** Cursor Cloud Agent (read-only pass on `dev` branch, 2026-05-26).

**Purpose:** Provide a structured finding list for other agents to **backtest** (confirm, refute, or downgrade each item with evidence).

---

## How to backtest a finding

For each finding below:

1. Read the cited file/lines in the current `dev` branch.
2. Attempt to reproduce the risk in a local/dev environment (in-memory mode is fine for auth/route checks; do **not** test against production).
3. Record one of: **Confirmed**, **Partially confirmed**, **False positive**, **Fixed** (with PR link).
4. Comment on the Linear parent ticket with finding ID, verdict, and evidence (curl command, test output, or code citation).

---

## Executive summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 4 |
| Medium | 7 |
| Low / informational | 8+ |

No committed production secrets, no obvious backdoors, no `postinstall` supply-chain hooks. Solid foundations: Helmet, CORS allowlist, parameterized SQL, HMAC webhooks, workspace membership checks, MCP URL guards on admin routes.

---

## Findings

### SEC-01 — Critical: Google Workspace connector trusts `X-User-Id` without JWT

| Field | Value |
|-------|-------|
| Severity | **Critical** |
| Files | `src/connectors/google-workspace/routes.ts` (lines 7–11, 48–52); `src/app.ts` (line 762) |
| Risk | Any caller can set `X-User-Id: <victim-uuid>` and store/read Google OAuth credentials for that user. Mount has no `requireAuth`. |

**Backtest steps:**

```bash
curl -s -X POST http://localhost:3000/api/connectors/google-workspace/credentials \
  -H 'Content-Type: application/json' \
  -H 'X-User-Id: 00000000-0000-0000-0000-000000000001' \
  -d '{"authMethod":"oauth2","label":"poc"}' | jq .
```

Expect today: request succeeds or returns validation error **without** 401 Missing Authorization. After fix: 401 without Bearer JWT.

---

### SEC-02 — High: `X-User-Id` header accepted as identity in `requireAuth`

| Field | Value |
|-------|-------|
| Severity | **High** |
| Files | `src/auth/authMiddleware.ts` (lines 276–310) |
| Risk | Routes `/api/memory/*`, `/api/knowledge/*`, and GET `/api/runs`, `/api/runs/*`, `/api/llm-configs` accept bare header as auth when Bearer is missing. |

**Backtest steps:**

```bash
curl -s http://localhost:3000/api/runs \
  -H 'X-User-Id: <known-user-uuid>' | jq .
```

Expect today: 200 or workspace-scoped data without JWT. After fix: 401.

---

### SEC-03 — High: Workflow condition evaluation uses `new Function` (RCE class)

| Field | Value |
|-------|-------|
| Severity | **High** |
| Files | `src/engine/stepHandlers.ts` (lines 444–453); `src/engine/WorkflowEngine.ts` (lines 120–126) |
| Risk | User-authored workflow condition strings compile to arbitrary JS in the API process. |

**Backtest steps:**

1. Create or import a workflow with condition: `process.env.DATABASE_URL || true`
2. Run the workflow and observe whether env vars leak into step output/logs.

After fix: condition parser should reject non-expression syntax.

---

### SEC-04 — High: SSRF in workflow MCP and webhook.send steps

| Field | Value |
|-------|-------|
| Severity | **High** |
| Files | `src/engine/stepHandlers.ts` (`handleMcp` ~601–636, `webhook.send` ~511–523) |
| Compare | `src/mcp/mcpUrlSecurity.ts` — admin MCP routes **do** validate URLs |
| Risk | Workflow steps `fetch()` arbitrary URLs including internal/metadata endpoints. |

**Backtest steps:**

1. Run workflow with MCP step pointing at `http://169.254.169.254/` or `http://127.0.0.1:3000/health`
2. Observe whether request is made (network log / step error with internal response).

After fix: same guards as `assertSafeMcpUrl`.

---

### SEC-05 — High: OAuth2 callback binds tokens to header user, not PKCE state

| Field | Value |
|-------|-------|
| Severity | **High** |
| Files | `src/integrations/integrationRoutes.ts` (lines 122–138); `src/integrations/authAdapters.ts` (PKCE state stores `userId` at line 78 but callback ignores it) |
| Risk | Captured `code`+`state` can be replayed with attacker's `X-User-Id`. |

**Backtest steps:**

1. Trace `completeOAuth2PkceFlow` — confirm returned credentials are stored under header `userId`, not `saved.userId`.
2. Code review: callback should use `pkceStateMap.get(state).userId`.

---

### SEC-06 — Medium: Landing blog stored XSS (local markdown fallback)

| Field | Value |
|-------|-------|
| Severity | **Medium** |
| Files | `landing/app/blog/[slug]/page.tsx` (lines 147–162) |
| Risk | `dangerouslySetInnerHTML` without sanitization on regex-rendered markdown. |

**Backtest steps:**

1. Add local article with content containing `<img src=x onerror=alert(1)>`
2. Load blog page — script should not execute after fix (DOMPurify or SSR-safe renderer).

---

### SEC-07 — Medium: `assertProductionSafety()` never called at boot

| Field | Value |
|-------|-------|
| Severity | **Medium** |
| Files | `src/security/qaBypassGuard.ts` (lines 97–114); `src/bootstrap.ts`; `src/index.ts` |
| Risk | QA bypass env vars won't fail startup in production (runtime guard still blocks bypass behavior). |

**Backtest:** grep for `assertProductionSafety` call sites — expect zero outside tests. After fix: called from `bootstrap.ts` or `index.ts` before listen.

---

### SEC-08 — Medium: Webhook relay allows `scheme: "none"`

| Field | Value |
|-------|-------|
| Severity | **Medium** |
| Files | `src/integrations/webhookRelay.ts` (lines 55, 154) |
| Risk | Unsigned inbound webhooks accepted when user selects `none` scheme. |

---

### SEC-09 — Medium: Global routing analytics leak

| Field | Value |
|-------|-------|
| Severity | **Medium** |
| Files | `src/app.ts` (lines 1677–1683); `src/engine/classificationLog.ts` |
| Risk | Any authenticated user sees process-wide classification log, not workspace-scoped. |

---

### SEC-10 — Medium: Ephemeral encryption key when env unset

| Field | Value |
|-------|-------|
| Severity | **Medium** |
| Files | `src/integrations/integrationCredentialStore.ts` (lines 39–45) |
| Risk | Dev/test uses `randomBytes(32)` per process when `INTEGRATION_CREDENTIAL_ENCRYPTION_KEY` unset. |

---

### SEC-11 — Medium: 50 MB in-memory file uploads (DoS)

| Field | Value |
|-------|-------|
| Severity | **Medium** |
| Files | `src/app.ts` (lines 566–569) |
| Risk | Concurrent large uploads can exhaust API memory. |

---

### SEC-12 — Medium: Unauthenticated template export

| Field | Value |
|-------|-------|
| Severity | **Medium** |
| Files | `src/app.ts` (lines 1074–1090) |
| Risk | Full workflow definitions readable without auth by template ID. May be intentional for marketplace — confirm product intent. |

---

### SEC-13 — Low: Webhook triggers gated but unsafe when enabled

| Field | Value |
|-------|-------|
| Severity | **Low** (default off) |
| Files | `src/app.ts` (lines 1942–1979) |
| Risk | When `WEBHOOK_TRIGGERS_ENABLED=true`, trusts `x-user-id` header. Currently returns 503 by default. |

---

### SEC-14 — Low: npm dependency advisories (moderate)

| Package | Location | Advisory |
|---------|----------|----------|
| `qs` 6.11.1–6.15.1 | Root via `express` | GHSA-q8mj-m7cp-5q26 (DoS) |
| `uuid` <11.1.1 | Nested under `@google-cloud/vertexai` | GHSA-w5hq-g745-h8pq |
| `brace-expansion` | Dashboard (`@sentry/bundler-plugin-core`) | GHSA-jxxr-4gwj-5jf2 |
| `js-yaml` | Landing (`@sanity/cli` chain) | GHSA-mh29-5h37-fv8m |

Run `npm audit` in root, dashboard, and landing workspaces.

---

### SEC-15 — Low: Dockerfile Infisical install via `curl | bash`

| Field | Value |
|-------|-------|
| Severity | **Low** (supply-chain hardening) |
| Files | `docker/api/Dockerfile` (line 70) |
| Risk | Unpinned remote installer. Consider checksum pinning or versioned apt repo. |

---

## Confirmed healthy patterns (do not "fix")

- Parameterized SQL throughout data layer
- No `child_process` in application code
- Webhook HMAC with `timingSafeEqual`
- MCP admin URL security (`assertSafeMcpUrl`)
- Workspace resolver membership gate
- CI grep for `requireRole()` on API mounts
- Secrets via Infisical / GitHub Secrets, not committed
- In-memory store blocked in production (HEL-80)
- QA bypass runtime guard returns false in production
- Helmet + CORS tests in `src/app.security.test.ts`

---

## Malicious code scan

No indicators of malicious intent: no obfuscated payloads, crypto miners, suspicious `postinstall` scripts, or exfiltration to unknown endpoints.

---

## Remediation priority

| Priority | Findings |
|----------|----------|
| P0 | SEC-01, SEC-02, SEC-03, SEC-04 |
| P1 | SEC-05, SEC-06, SEC-07, SEC-14 |
| P2 | SEC-08 through SEC-12, SEC-15 |

---

## Out of scope (not tested)

- Live SSRF/auth bypass against deployed Fly/Cloudflare environments
- Supabase RLS policy completeness in production DB
- Cloudflare Pages edge functions
- Stripe/Supabase dashboard configuration
