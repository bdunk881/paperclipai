---
name: composio-integration
description: >-
  Composio (OAuth/integration broker for AI agents) product knowledge + the AutoFlow
  integration plan. Load when designing or implementing AutoFlow's migration from
  hand-built connectors to Composio-native auth/tools/triggers/MCP. Covers the v3 model
  (toolkits, tools, auth configs, connected accounts, sessions, tool router), white-labeling
  the OAuth/consent screen, programmatic auth-config provisioning, tool fetch/execute/custom/proxy,
  before-execution modifiers (HITL gating), triggers + webhooks + signature verification +
  connection-expiry events, importing existing connections, multi-account, providers
  (@composio/anthropic, @composio/claude-agent-sdk) + MCP, projects/orgs (multi-tenancy), and
  the AutoFlow-specific mapping (missions, agent teams, skills, tools, the DAG, connectors,
  workspaces, white-label via our domains). Source: docs.composio.dev + github.com/ComposioHQ/composio
  (MIT), read line-by-line 2026-06-05.
---

# Composio integration — product knowledge + AutoFlow plan

**What Composio is:** a hosted OAuth/integration/tool-calling broker for AI agents. It "powers 1000+ toolkits, tool search, context management, authentication, and a sandboxed workbench." It **owns the hard parts AutoFlow is hand-building**: app registrations, OAuth client apps, credential storage + encryption + token refresh, the hosted consent/Connect-Link flow, per-user connected accounts, event triggers/webhooks, and tool execution. Library is **MIT**; the platform is a paid hosted backend (`backend.composio.dev`). TS SDK `@composio/core`; Python `composio`.

**Why AutoFlow is adopting it (Brad, 2026-06-05):** hand-building connectors (registering redirect URIs per provider, app approvals, credential stores) is infeasible in startup mode. Composio = the OAuth broker we already list as a potential integration; using it **natively** scales us from ~15 connections to 100s–1000s. We **white-label the auth screen**, and use its **API-key, OAuth, and MCP** integration modes. This fundamentally changes missions, mission generation, agent teams, skills, tools, and the **DAG** — a big lift across UI/UX/dashboard routing, RR7 frontend, and the API.

> Full Composio doc sitemap (every page URL, for fetch-on-demand during implementation) is in `reference/doc-index.md`. Clean markdown of any page = append `.md` to its `/docs/...` URL (e.g. `https://docs.composio.dev/docs/authentication.md`). `https://docs.composio.dev/llms-full.txt` = entire docs in one file.

---

## 1. The v3 object model (memorize this)

```
Organization                      top-level account; x-org-api-key for org/project mgmt
 └─ Project                       isolation boundary: scopes API key (x-api-key), connected
                                  accounts, auth configs, webhooks. "Resources in one project
                                  are NOT accessible from another." Multi-tenant primitive.
     ├─ Auth Config  (ac_xxx)     BLUEPRINT per toolkit: auth scheme (OAUTH2/API_KEY/BEARER_TOKEN/
     │                            BASIC) + scopes + credentials. Either Composio-managed creds OR
     │                            your own client_id/secret ("custom"). One config → all users.
     ├─ Connected Account (ca_xxx) a USER's authenticated instance of a toolkit. Stores tokens/keys
     │                            linked to YOUR user_id. Auto-refreshes OAuth. Lifecycle:
     │                            INITIATED → ACTIVE → INACTIVE(disabled) → EXPIRED/FAILED.
     │                            Multiple per toolkit per user (work + personal). Aliases.
     ├─ Trigger Instance (ti_xxx) a live event listener bound to one connected account
     └─ Webhook Subscription      one per project: the URL Composio POSTs signed events to
```

- **Toolkit** (slug `github`, `gmail`, `slack`) = an app; a collection of **Tools**.
- **Tool** = one action, named `TOOLKIT_ACTION` (e.g. `GITHUB_CREATE_ISSUE`, `GMAIL_SEND_EMAIL`), with input/output JSON schema.
- **User ID / Entity** = YOUR app's user identifier (use DB UUID/PK, never email, never `default` in prod). Scopes connected accounts, executions, authorizations. Passed to `composio.create(userId)` / `tools.execute({userId})`.
- **Session** = runtime context: `composio.create(userId, {...})`. Binds user → tools, auth configs, connected accounts, state. Persists server-side, **does not expire**; reuse via `composio.use(sessionId)`. Exposes `session.tools()` (native), `session.mcp.url`/`session.mcp.headers` (MCP), `session.authorize(...)`, `session.toolkits()`, `session.update(...)`.
- **Tool Router + Meta Tools** (auto-included in sessions): `COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_GET_TOOL_SCHEMAS`, `COMPOSIO_MANAGE_CONNECTIONS` (in-chat auth), `COMPOSIO_MULTI_EXECUTE_TOOL`, `COMPOSIO_REMOTE_BASH_TOOL`, `COMPOSIO_REMOTE_WORKBENCH` (persistent Python sandbox). Lets an agent discover/auth/execute across 1000s of tools without loading every schema.
- **Provider** = adapter package converting Composio tools → a framework's tool format. Built-ins: `@composio/openai` (default), `@composio/anthropic`, `@composio/claude-agent-sdk`, `@composio/vercel`, `@composio/google`, `@composio/langchain`, `@composio/mastra`, `@composio/cloudflare` (+ Python equivalents). MCP needs **no** provider. Custom providers supported.
- **Modifiers** = middleware: `schema` (adjust tool def), `beforeExecute` (mutate/gate args — **our HITL hook**), `afterExecute` (transform result).
- **Two execution styles:** (a) **Sessions / Tool Router** (newer, agentic, meta-tools) and (b) **Direct execution** (`composio.tools.get/execute`, `composio.connectedAccounts.initiate`) — explicit, full control. Both share the same auth/connected-account model.

**IDs/prefixes:** `ac_` auth config · `ca_` connected account · `ti_` trigger instance · `we_` webhook endpoint · `proj_`/`pr_` project · `ok_` org · `ak_`/`ck_` API key.
**Env:** `COMPOSIO_API_KEY` (project-scoped), `COMPOSIO_WEBHOOK_SECRET`, org key via dashboard.

---

## 2. Auth — the core of the AutoFlow lift

**Managed vs custom credentials.** Managed = Composio's own OAuth apps, zero setup, but shared rate-limit quota, ≥15-min polling, and **"Composio wants to access…"** on the consent screen. **Custom** = your own OAuth app per toolkit → your brand on consent, dedicated quota, faster polling, custom scopes/instances. You can **mix** per toolkit. For AutoFlow prod we use **custom** for user-facing toolkits (branding) and may use managed for the long tail.

**Provision auth configs PROGRAMMATICALLY** (we do this, not the dashboard, to cover 1000s of apps):
```ts
// managed
await composio.authConfigs.create("GITHUB", { name: "GitHub", type: "use_composio_managed_auth" });
// custom (our own OAuth app) — OAuth2
await composio.authConfigs.create("NOTION", {
  type: "use_custom_auth", authScheme: "OAUTH2",
  credentials: { client_id, client_secret,
    oauth_redirect_uri: "https://backend.composio.dev/api/v3.1/toolkits/auth/callback" },
});
// custom — API key toolkit
await composio.authConfigs.create("PERPLEXITYAI", { type: "use_custom_auth", authScheme: "API_KEY", credentials: {} });
// scopes override
await composio.authConfigs.create("HUBSPOT", { type: "use_composio_managed_auth", credentials: { scopes: "sales-email-read,tickets" } });
// discover required fields per toolkit/scheme
await composio.toolkits.getAuthConfigCreationFields("NOTION", "OAUTH2", { requiredOnly: true });
```
Returns `ac_xxx` — **store it** (per workspace×toolkit). Managed OAuth redirect URI is always `https://backend.composio.dev/api/v3.1/toolkits/auth/callback`.

**Authenticate a user (manual / backend-driven — our model):**
```ts
const conn = await composio.connectedAccounts.initiate(userId, authConfigId, {
  callbackUrl: "https://app.../integrations/callback?...",   // post-auth return to OUR app
  allowMultiple: true,                                        // multiple accounts per toolkit
  config: { auth_scheme: "OAUTH2", val: { status: "INITIALIZING", long_redirect_url: true } }, // white-label step 3
});
conn.redirectUrl;                                            // the Connect Link → redirect the user
const account = await composio.connectedAccounts.waitForConnection(conn.id); // or poll status
// callback gets ?status=success&connected_account_id=ca_xxx appended (existing params preserved)
```
Session style: `session.authorize("gmail", { authConfigId, callbackUrl, alias })` → `{ redirectUrl, waitForConnection() }`.

**Connected-account lifecycle ops:** `list({userIds,statuses})` · `get(id)` (`.state.authScheme`/`.state.val` creds, masked `gho_…` by default) · `refresh(id)` · `enable/disable(id)` (disabled ≠ executable) · `delete(id)` (permanent) · `update(id, {alias, connection:{state:{authScheme,val}}})`. **INACTIVE accounts can't execute tools.** Secret masking toggled per-project via `mask_secret_keys_in_connected_account`.

**Import our existing 15 connections** (no re-auth) via `connectedAccounts.initiate(userId, authConfigId, { config: AuthScheme.APIKey({api_key}) | AuthScheme.BearerToken({token}) | AuthScheme.Basic({username,password}) })`. ⚠ Bearer/OAuth import = **we** own refresh (Composio won't refresh a token it didn't mint).

### White-labeling the auth screen — the 4 branding points (CRITICAL, Brad confirmed requirement)
| # | Where "Composio" shows | Fix |
|---|---|---|
| 1 | **Connect Link page** | Dashboard → Project Settings → **Auth Screen** → upload our logo + app title (applies to all toolkits) |
| 2 | **OAuth consent screen** ("Composio wants access") | Use **our own OAuth app** (custom auth config). Removes the "Secured by Composio" badge. API-key toolkits have no consent screen → N/A |
| 3 | **Outgoing redirect** (`backend.composio.dev` in URL bar) | `config.val.long_redirect_url: true` on `initiate` → sends user straight to the provider |
| 4 | **Return redirect** (callback via Composio domain) | Register OAuth redirect URI as `https://OURDOMAIN/api/composio-redirect`; serve a **302 proxy** that forwards `?{query}` to `https://backend.composio.dev/api/v3.1/toolkits/auth/callback`; update the auth config to our custom redirect URI. (Must be a 302 — don't fetch server-side.) Plus `callbackUrl` for the post-auth success page back into our app. |

---

## 3. Tools, triggers, MCP

**Fetch tools** (direct): `composio.tools.get(userId, { toolkits:["GITHUB"], tools:["GITHUB_CREATE_ISSUE"], search:"create issue", scopes:["write:org"], limit })` (default top-20). Schemas w/o user: `tools.getRawComposioTools({toolkits})`, `getRawComposioToolBySlug(slug)`.

**Execute** (no LLM needed): `composio.tools.execute("GMAIL_SEND_EMAIL", { userId, connectedAccountId?, arguments, beforeExecute? })` → `{ data, successful, error }`. **userId mandatory.** Toolkit versioning via `new Composio({ toolkitVersions:{github:"20251027_00"} })` (pin when code parses output; `latest` when an LLM consumes it). **Proxy** undocumented endpoints: `composio.tools.proxyExecute({ endpoint, method, connectedAccountId, parameters:[{name,value,in:"header"|"query"}] })`. Auto file up/download behind `dangerouslyAllowAutoUploadDownloadFiles` + a path denylist (`.ssh`/`.aws`).

**Custom tools** (our own actions alongside Composio's): `composio.tools.createCustomTool({ slug, name, description, toolkitSlug?, inputParams: z.object({...}), execute: async (input, connectionConfig, executeToolRequest) => ({data,error,successful}) })`. `executeToolRequest` auto-injects the connected account's creds + baseURL (same toolkit only). ⚠ Custom tools live in memory only (re-register on boot).

**Modifiers — `beforeExecute` is our HITL/governance interception:**
```ts
await composio.tools.execute(slug, { userId, arguments }, {
  beforeExecute: ({ toolSlug, params }) => { /* inspect/mutate args, OR gate for approval */ ; return params; },
});
// or attach at tools.get(userId, {tools}, { beforeExecute })
```
Use to enforce our approval tiers / spend gates / arg sanitization before a Composio tool fires (maps onto our `_evaluateActionGovernance`).

**Triggers (event → AutoFlow).** Webhook (real-time push: Slack/Notion/Outlook) or polling (Gmail/Calendar; ≤15-min on managed). A **trigger type** (`GITHUB_COMMIT_EVENT`) + config → a **trigger instance** bound to a user's connected account. Flow: subscribe once per project → discover types → `composio.triggers.create/enable(...)` per user → receive at our webhook → route on `metadata.trigger_slug`/`trigger_id`. Inspect payload schema: `composio.triggers.getType("GITHUB_COMMIT_EVENT").payload`. Local dev: `composio.triggers.subscribe(cb, {triggerId})` (WebSocket) + ngrok.

**Webhook subscription + events** (one URL/project):
```bash
POST https://backend.composio.dev/api/v3.1/webhook_subscriptions
  { "webhook_url":"https://OURDOMAIN/webhooks/composio",
    "enabled_events":["composio.trigger.message","composio.connected_account.expired","composio.trigger.disabled"] }
```
Event payload: `{ id, type, metadata:{trigger_slug,trigger_id,connected_account_id,auth_config_id,user_id}, data:{...}, timestamp }`. Composio uses **dynamic outbound IPs** → no IP allowlisting; authenticate via signature.

**Verify webhook (HMAC-SHA256):** headers `webhook-id`, `webhook-timestamp`, `webhook-signature`. Sign `{id}.{timestamp}.{rawBody}` with `COMPOSIO_WEBHOOK_SECRET`, base64, `timingSafeEqual` (sig may be `v1,<b64>`), 300s replay tolerance. Maps onto our existing `webhooks/verifySignature`.

**Connection expiry → re-auth:** subscribe `composio.connected_account.expired` → payload `data:{id:ca_, toolkit:{slug}, status:"EXPIRED", status_reason}` → look up user → `session.authorize(toolkit)` → push the new Connect Link (drives our connection-health UX).

**Native tools vs MCP.** Native (`session.tools()` + provider) = full interception/approval, token-efficient, you pick schemas. MCP (`session.mcp.url` + `session.mcp.headers`, per-user auth in headers) = framework-agnostic, simplest, but the client pulls the whole tool list (a 5-server setup can be ~55K tokens up front) and less interception. Claude Agent SDK MCP wiring:
```ts
mcp_servers: { composio: { type:"http", url: session.mcp.url, headers: session.mcp.headers } }
```
`require_mcp_api_key` defaults **true** for orgs created ≥ 2026-03-05.

**Anthropic provider (we run Claude):**
```ts
const composio = new Composio({ provider: new AnthropicProvider() });
const session = await composio.create(userId); const tools = await session.tools();
let res = await anthropic.messages.create({ model, max_tokens, tools, messages });
while (res.stop_reason === "tool_use") {
  const toolResults = await composio.provider.handleToolCalls(userId, res);
  messages.push({role:"assistant",content:res.content}, ...toolResults);
  res = await anthropic.messages.create({ model, max_tokens, tools, messages });
}
```
There is also a dedicated **`@composio/claude-agent-sdk`** provider (`new ClaudeAgentSDKProvider()`) that hands tools to `@anthropic-ai/claude-agent-sdk` — directly relevant to our `src/agents/runtime`.

---

## 4. AutoFlow implementation map (what changes — guides the plan)

> Verified against our code this session (see [[workflow-builder-engine-e2e-audit]] + [[functionality-audit-2026-06]]). This is a big lift across UI/UX/dashboard routing, RR7 frontend, and the API.

- **Tenancy decision (do first):** map our **workspace → Composio project** (max isolation: own API key, connected accounts, auth configs, webhook per customer; uses `x-org-api-key` to create projects) **vs.** one shared project + `userId = workspace:user`. Per-workspace projects align with our RLS + per-tenant isolation and white-label, at the cost of N projects + N API keys to manage. **Lean: one Composio project per workspace.** Either way, `user_id` = our user/agent identity.
- **Connectors → Composio.** Replace the hand-built connector-action library (`src/engine/connectorActions/`, HEL-656 registry) and bespoke OAuth with Composio toolkits/tools. Our `executeAction`/`stepHandlers` "action" + "mcp" steps dispatch to `composio.tools.execute` (or the agent gets tools via the provider/MCP). Kills the fabricated-CRM/content stubs (`WorkflowEngine.ts:120-125`) — real tools now.
- **Auth configs provisioned programmatically**, one per workspace×toolkit, **custom credentials** (our OAuth apps) for branding; store `ac_` IDs in our DB. White-label via §2 (logo + own OAuth app + `long_redirect_url` + 302 callback-proxy through `dev-api`/`app.helloautoflow.com`).
- **Integrations dashboard** (RR7 + API): build the connections page from the cookbook pattern — list toolkits, show per-workspace-user connection status (`session.toolkits()` → `connection.isActive`/`connectedAccount.id`), Connect → `initiate`→`redirectUrl`, Disconnect → `connectedAccounts.delete`, re-auth on expiry. Replaces our `integrations/` UI + `integrationCredentialStore`.
- **Triggers → the DAG / trigger catalog.** Composio triggers directly fill the §A trigger-catalog gaps (Linear **HEL-675** app/event triggers, and more): a Composio webhook event (`composio.trigger.message`) becomes a workflow/agent trigger. Wire one Composio webhook subscription per project → our `/webhooks/composio` (HMAC verify) → route by `trigger_slug` + `user_id` into the wake/triage + run engine ([[comms-inbound-wake-triage]]). This is the scalable replacement for per-app trigger wiring and the dead `event`/`webhook` routine kinds (**HEL-675**, worker.ts stub).
- **Connection-expiry** webhook → our connection-health + re-auth notifications (Resend/in-app).
- **Governance/HITL** preserved via `beforeExecute` modifiers (gate Composio tool calls through our approval tiers — maps to `_evaluateActionGovernance`).
- **Agent runtime:** give agents Composio tools via `@composio/claude-agent-sdk` / `@composio/anthropic` provider **or** `session.mcp.url` into the middleware pipeline ([[agent-runtime-middleware-pipeline]]). MCP step + our MCP store can point at Composio MCP.
- **Missions / mission-generation / agent teams / skills:** the tool universe expands from ~15 to 1000s of Composio tools → mission build + team-assembly + skills selection must reason over Composio's toolkit/tool catalog (search via `COMPOSIO_SEARCH_TOOLS` / `tools.get(search)`), and the LLM prompts/schemas that pick tools/skills need to enumerate Composio toolkits.
- **Custom tools** (`createCustomTool`) for AutoFlow-specific actions Composio doesn't cover; **proxy** for long-tail/undocumented APIs.
- **Security:** Composio holds the creds (offloads our credential store + the SSRF surface of hand-built HTTP), but adds: verify webhook signatures (HMAC), keep `COMPOSIO_API_KEY` per-project secret, decide secret-masking, and the dependency/data-residency review (Composio is a third party holding customer OAuth tokens — DPA/compliance check before prod).

**Open decisions for the plan:** project-per-workspace vs shared; native-provider vs MCP for agent tools (or both); which toolkits get custom OAuth apps first (branding) vs managed; how Composio triggers reconcile with our existing trigger/routine model; migration of the existing 15 connections (import vs re-auth).

---

## 5. Pointers
- `reference/doc-index.md` — every Composio doc URL (fetch `<url>.md` for clean markdown; `llms-full.txt` = all docs).
- Not-yet-deep-read (fetch on demand during impl): `configuring-sessions`, `tools-and-toolkits`, `providers/custom-providers/typescript` (if we build a provider for our runtime), `proxy-execute`, `schema-modifiers`/`after-execution-modifiers`, `observability`, `reference/v3/api-reference/*` (exact REST schemas: auth-configs, connected-accounts, tools, triggers, mcp, webhook-*), `cli`, Rube (hosted MCP), `workbench`.
- Source: docs.composio.dev (read 2026-06-05) + github.com/ComposioHQ/composio (MIT).
