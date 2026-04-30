# Tier 1 Provider-Facing Connector Suite

This suite validates the live Tier 1 connector contract against provider-managed sandboxes or dedicated test accounts.

## Covered connectors

- `apollo`
- `gmail`
- `hubspot`
- `jira`
- `linear`
- `sentry`
- `slack`
- `stripe`
- `teams`

## What the suite checks

- Auth/connect: the live token can be stored through the connector service.
- Basic read: a connector-specific read path succeeds with the stored credential.
- Failure handling: an invalid token is rejected by the provider-facing path.
- Basic write where applicable: write tests are enabled only when the required sandbox fixture IDs are configured.

## Required secrets

Set these GitHub Actions secrets before enabling the workflow:

- `TIER1_APOLLO_API_KEY`
- `TIER1_GMAIL_API_KEY`
- `TIER1_HUBSPOT_API_KEY`
- `TIER1_JIRA_API_TOKEN`
- `TIER1_LINEAR_API_KEY`
- `TIER1_SENTRY_API_KEY`
- `TIER1_SLACK_BOT_TOKEN`
- `TIER1_STRIPE_API_KEY`
- `TIER1_TEAMS_API_KEY`

## Optional fixture variables for write scenarios

Set these GitHub Actions repository variables to turn on the corresponding write tests:

- `TIER1_GMAIL_TO_EMAIL`
- `TIER1_HUBSPOT_CONTACT_ID`
- `TIER1_JIRA_EMAIL`
- `TIER1_JIRA_ISSUE_KEY`
- `TIER1_JIRA_PROJECT_KEY`
- `TIER1_JIRA_SITE`
- `TIER1_LINEAR_ISSUE_ID`
- `TIER1_SLACK_CHANNEL_ID`
- `TIER1_STRIPE_CUSTOMER_ID`
- `TEAMS_TENANT_ID`

## CI enablement

The workflow is defined in `.github/workflows/provider-facing-connectors.yml`.

- Enable it with repository variable `TIER1_PROVIDER_TESTS_ENABLED=true`.
- The workflow sets `REQUIRE_ALL_TIER1_CONNECTORS=true`, so missing connector secrets fail fast instead of silently skipping coverage.

## Local execution

Run the suite locally with:

```bash
npm run test:connectors:provider
```

Without connector env vars, the connector suites are skipped by default.

## Test data lifecycle

- `stripe` write coverage creates a draft invoice against a test customer and deletes it in the same run.
- `apollo` currently validates auth and read access only.
- `hubspot` and `linear` write coverage update reusable fixture records, so those fixtures should be dedicated to QA.
- `jira` write coverage updates a reusable fixture issue when `TIER1_JIRA_ISSUE_KEY` is configured.
- `gmail` write coverage sends to a dedicated test mailbox when `TIER1_GMAIL_TO_EMAIL` is configured.
- `slack` write coverage posts to a dedicated sandbox channel when `TIER1_SLACK_CHANNEL_ID` is configured.

Keep fixture resources scoped to QA-only sandboxes so repeated smoke runs do not pollute shared production workspaces.
