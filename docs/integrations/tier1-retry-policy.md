# Tier 1 Connector Error Classification And Retry Policy

This document defines the standard policy for AutoFlow Tier 1 connector execution paths:

- Slack
- HubSpot
- Stripe
- Gmail
- Linear
- Sentry
- Microsoft Teams
- Jira ticket-sync

## Standard Error Classification

Every Tier 1 connector maps provider failures into one of these internal error types:

- `auth`: invalid credentials, revoked scopes, expired or rejected tokens, forbidden access
- `rate-limit`: provider throttling, `429`, or provider-specific rate-limit payloads
- `schema`: malformed request payloads, unsupported parameters, validation failures, or other permanent `4xx` request issues
- `network`: transport failures before a usable HTTP response is received
- `upstream`: transient provider-side failures, including `5xx` responses and retriable provider errors

These types roll up into four operator-facing categories:

- `auth-related`: never retried automatically
- `rate-limit-related`: retried with provider `Retry-After` when available; surfaces connector health as `degraded` when exhausted
- `retryable`: transient `network` or `upstream` failures; retried with exponential backoff and jitter
- `non-retryable`: `schema` failures; fail fast and require request or configuration correction

## Standard Retry Policy

The shared Tier 1 retry helper enforces the same decision rules across all eight connectors:

- Retry `rate-limit`, `network`, and `upstream` failures only
- Do not retry `auth` or `schema` failures
- Prefer provider `Retry-After` headers when present
- Otherwise use exponential backoff with jitter
- Stop after the connector-specific max attempt budget and surface the final classified error

Current max-attempt budgets:

- Slack: 3 retries
- Gmail: 3 retries
- HubSpot: 4 retries
- Stripe: 4 retries
- Linear: 4 retries
- Sentry: 4 retries
- Microsoft Teams: 4 retries
- Jira ticket-sync: 4 retries

## Idempotency Expectations

Retries are only safe when write operations are idempotent or side effects are guarded:

- Stripe write calls rely on deterministic request bodies and are expected to remain safe across connector-managed retries
- Jira ticket-sync comment echo suppression uses mirrored idempotency metadata
- Operators should treat `schema` failures on writes as permanent and correct the payload before replay

If a new write endpoint is added to a Tier 1 connector, idempotency must be reviewed before enabling automatic retries for that path.

## Health-State Mapping

Connector and ticket-sync health checks must expose failures consistently:

- `ok`: provider reachable and authenticated
- `degraded`: rate-limit exhaustion or active provider throttling
- `down`: auth failure, permanent request failure, or provider/network outage

This keeps QA evidence and operator dashboards aligned with the same internal error taxonomy.

## Recovery Playbook

Use this sequence when a Tier 1 connector is failing:

1. `auth` failure: re-connect the credential, verify scopes, and re-run the connector health endpoint.
2. `rate-limit` failure: wait for the provider recovery window, reduce polling or bulk write volume, and verify the health endpoint moves from `degraded` back to `ok`.
3. `network` or `upstream` failure: verify provider status, inspect recent retry exhaustion logs, and retry the operation after the provider recovers.
4. `schema` failure: inspect the request payload or connector configuration, correct the permanent error, and rerun without waiting for automatic recovery.
5. Credential revocation: revoke the stored connector credential in AutoFlow, re-authorize, and confirm the new credential passes both health and a representative read call.
