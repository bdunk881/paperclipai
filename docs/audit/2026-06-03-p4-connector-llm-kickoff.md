# P4 Connector + LLM Hardening Kickoff

Date: 2026-06-03
Linear: HEL-443

## Scope

This is a kickoff inventory for the P4 phase project. It does not implement
connector or LLM changes. The goal is to establish the current shipped baseline,
identify non-duplicative risks, and recommend PR-sized follow-up work.

## Linear baseline

The P4 project was moved to In Progress and the completed Slack/connector
hardening chain was attached to it for continuity:

- HEL-179: Slack hardening audit plus connector health surface.
- HEL-180: Slack credentialStore migrated onto `CredentialRegistry` and
  `connectorSecretVault`.
- HEL-181: Slack required-scope health degradation.
- HEL-182: hydrate-before-upsert sweep across HubSpot, Gmail, Stripe, Apollo,
  Composio, and Sentry credential stores.
- HEL-183: repo-wide `asyncHandler` wrapper and typed error middleware.

Active overlap to avoid:

- HEL-420, HEL-421, HEL-424, and HEL-440 are recent or active
  Functionality Audit / Claude-owned issues around hosted models, LLM credential
  reads, and AAL2 credential access. P4 should not duplicate those tickets.

## Current connector baseline

| Surface | Current state | Anchors |
| --- | --- | --- |
| Shared Tier-1 health contract | Exists. Defines canonical statuses, recommended next actions, and health transition logging. | `src/integrations/shared/tier1Contract.ts` |
| Connector health API | Live API probes Slack, HubSpot, Stripe, Gmail, Sentry, Linear, Teams, Apollo, and Composio. | `src/connectors/health.ts`, `src/app.ts` `GET /api/connectors/health` |
| Dashboard health UI | Dedicated route exists and the Connections page also consumes health. Mock-health guard throws if API still serves mock telemetry. | `dashboard/src/pages/ConnectorHealth.tsx`, `dashboard/src/pages/Connections.tsx`, `dashboard/src/api/client.ts` |
| Credential registry | Shared encrypted registry persists to `connector_credentials`, supports key versions, and is RLS-aware via `withUserContext`. | `src/integrations/shared/credentialRegistry.ts`, `migrations/006_connector_credentials.sql`, `migrations/083_rls_user_scoped.sql` |
| Shared credential wrapper | Newer surfaces can store typed metadata plus encrypted secret payloads on the registry. | `src/integrations/shared/sharedCredentialStore.ts` |

## Tier-1 connector status

| Connector | Status | Notes |
| --- | --- | --- |
| Slack | Strongest baseline. Dedicated OAuth/API-key connector, webhook signature + replay guard, registry-backed credentials, scope degradation in `health()`, dashboard health coverage. | `src/integrations/slack/*` |
| HubSpot | Dedicated OAuth/API-key connector, webhook signature + replay guard, registry-backed credentials, hydrate-before-upsert fix landed in HEL-182. No obvious per-operation scope subset guard equivalent to Slack. | `src/integrations/hubspot/*` |
| Gmail | Dedicated connector is mounted at `/api/integrations/gmail` and included in health. Credential store uses `CredentialRegistry`, and Gmail Pub/Sub webhook verification exists. | `src/integrations/gmail/*` |
| Google Workspace legacy | Separate legacy surface is mounted at `/api/connectors/google-workspace`. It uses `SharedCredentialStore`, but route auth is a hard gap: routes derive identity from `X-User-Id` instead of `requireAuth` / `workspaceResolver`. | `src/connectors/google-workspace/routes.ts`, `src/app.ts` |
| Linear | Dedicated OAuth/API-key connector, webhook signature + replay guard, included in health. Credential store still has a local AES helper instead of the shared registry encryption helper. | `src/integrations/linear/*` |
| Stripe | Dedicated OAuth/API-key connector, Stripe Connect webhook mount, included in health. Credential store uses `CredentialRegistry`; scope handling is present through Stripe OAuth scope parsing. | `src/integrations/stripe/*` |
| GitHub | Not a dedicated Tier-1 service. It is a generic integration-catalog manifest with bearer auth, OAuth support, actions, and webhook relay support. It is not included in `CONNECTOR_HEALTH_PROBES`, so P4 cannot currently show GitHub health in the Tier-1 health dashboard. | `src/integrations/integrationCatalog.ts`, `src/integrations/integrationRoutes.ts`, `src/integrations/webhookRelay.ts` |

## Connector risks

1. `src/connectors/google-workspace/routes.ts` is mounted without `requireAuth`
   and trusts `X-User-Id`. That is the clearest P4 security bug because a
   caller can select an identity by header on credential, listing, sync, and
   health routes.
2. `src/integrations/integrationCredentialStore.ts` still uses a separate AES
   envelope. It falls back to `randomBytes(32)` when
   `INTEGRATION_CREDENTIAL_ENCRYPTION_KEY` / `LLM_CONFIG_ENCRYPTION_KEY` is
   absent. That preserves dev/test behavior but is weaker than
   `connectorSecretVault` key-version rotation and can invalidate generic
   catalog credentials across restarts if the env var is missing.
3. GitHub is listed as a Tier-1 P4 connector in product scope, but the shipped
   implementation is generic catalog/actions plus webhook relay. It lacks a
   dedicated health probe and provider-specific reconnect/status semantics.
4. There are two Google paths: the dedicated Gmail connector and the older
   Google Workspace connector. They should be reconciled before broadening
   Google Workspace claims in product surfaces.

## Current LLM baseline

| Surface | Current state | Anchors |
| --- | --- | --- |
| LLM credentials API | Canonical dashboard client uses `/api/llm-credentials`; backend still mounts both `/api/llm-configs` and `/api/llm-credentials`. Secrets are masked on reads. | `src/app.ts`, `src/llmConfig/llmConfigRoutes.ts`, `dashboard/src/api/client.ts` |
| Credential storage | `llmConfigStore` uses `SharedCredentialStore`, which rides on `CredentialRegistry` / `connectorSecretVault`. | `src/llmConfig/llmConfigStore.ts` |
| Access control | Current dev branch still mounts LLM credential routes behind `requireAAL2` for all verbs. This overlaps with active HEL-440, which is specifically scoped to degate reads while preserving AAL2 on mutations. | `src/app.ts`, HEL-440 |
| Tier routing | Workspace matrix supports `small`, `medium`, `large`, `embeddings`, and `vision`; dashboard exposes only small/medium/large as Lite/Standard/Power. Patch validation rejects providers with no connected credential. | `src/llmConfig/tierRouter.ts`, `src/llmConfig/tierRoutingRoutes.ts`, `dashboard/src/api/tierRoutingApi.ts` |
| Provider adapters | Registry covers native adapters plus OpenAI-compatible long tail: OpenAI, Anthropic, Bedrock, Gemini, Mistral, Vertex AI, Cohere, Groq, Fireworks, Together, xAI, Perplexity, DeepSeek, Ollama, LocalAI, and OpenCode Zen. `openrouter` is a provider name but is not registered in `src/llmConfig/adapters/index.ts`. | `src/llmConfig/adapters/index.ts`, `src/engine/llmProviders/types.ts` |
| Dashboard model settings | Models page supports provider key creation, hosted-free display, and tier cards. It validates form shape but does not perform a live provider credential probe before saving. | `dashboard/src/pages/LLMProviders.tsx` |

## LLM risks

1. Do not create a P4 ticket for LLM credential GET AAL2 behavior until HEL-440
   resolves. That issue is active and more specific.
2. There is no live provider validation endpoint on credential create/update.
   `validateProviderConfig()` checks shape only, so a typoed key can be saved
   and fail later at run time.
3. `openrouter` is in `PROVIDER_NAMES` and the legacy provider factory, but it
   is not in the normalized adapter registry. That is acceptable if hosted
   credits intentionally bypass the adapter layer, but it should be documented
   or tested as a deliberate split.
4. Tier fallback metadata exists in `TierBinding.fallback`, but the current
   route/dashboard surface only validates and stores primary bindings. P4
   should decide whether runtime fallback is MVP or post-MVP.

## Recommended follow-up sequence

1. Google Workspace auth hardening: put `/api/connectors/google-workspace`
   behind normal auth/workspace middleware and remove `X-User-Id` trust.
2. Generic integration credential vault hardening: migrate
   `integrationCredentialStore` to `connectorSecretVault` / key-versioned
   shared storage or fail fast when the integration encryption key is absent
   outside dev/test.
3. GitHub Tier-1 health: either promote GitHub to a dedicated health probe with
   reconnect guidance or explicitly mark it as generic-catalog-only until a
   deeper GitHub connector is scheduled.
4. LLM provider live validation: add a lightweight provider probe on create /
   update and surface validation state in the Models page.
5. LLM tier fallback decision: document whether `TierBinding.fallback` is
   runtime-supported in MVP; if yes, add dashboard/API support and tests.

## Ticketing notes

Filed under P4 and blocked by HEL-443:

- HEL-453: Google Workspace connector auth hardening.
- HEL-454: Generic integration credential vault migration.

The LLM credential read behavior is intentionally not filed here because it is
already covered by active Claude-owned work.
