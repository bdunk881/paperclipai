# Tier 1 Launch Readiness Matrix

Purpose
- Provide the QA-owned launch gate for Tier 1 connector hardening work under `ALT-1949`.
- Record the exact evidence available for each launch requirement before CTO and CEO sign-off.
- Fail closed: if a requirement is incomplete, blocked, or only partially evidenced, launch readiness stays red.

Status
- Overall launch gate: `blocked`
- Last QA update: `2026-04-28`
- QA reviewer: `QA Engineer`

## Current blocker summary

Open prerequisite issues currently prevent sign-off:

- `ALT-1942` — staging deployment pipeline and rollback is still `in_progress`
- `ALT-1943` — live OAuth verification with real credentials is still `in_progress`
- `ALT-1944` — standard retry policy is still `todo`
- `ALT-1945` — connector health-state model is still `blocked`
- `ALT-1947` — SDK `v1` contract freeze and contract tests are still `todo`
- `ALT-1948` — provider-facing live integration suite is currently `blocked`

Scope conflict that must be resolved before sign-off:

- The parent PRD for `ALT-1905` names `Jira` as a Tier 1 connector.
- The implemented provider-facing suite and connector code cover `Microsoft Teams` instead.
- There is no `src/integrations/jira` implementation in the repository as of this QA review.

## Evidence captured in this QA pass

Automated evidence executed in this heartbeat:

- Connector unit suites passed for implemented Tier 1 connectors:
  - Command: `npm test -- --runInBand src/integrations/apollo/apolloConnector.test.ts src/integrations/gmail/gmailConnector.test.ts src/integrations/hubspot/hubspotConnector.test.ts src/integrations/linear/linearConnector.test.ts src/integrations/sentry/sentryConnector.test.ts src/integrations/slack/slackConnector.test.ts src/integrations/stripe/stripeConnector.test.ts src/integrations/teams/teamsConnector.test.ts`
  - Result: `8` suites passed, `62` tests passed
- Provider-facing live suite was not executable in this local QA heartbeat because required Tier 1 provider secrets were not present:
  - Command: `npm run test:connectors:provider`
  - Result: `1` suite skipped, `30` tests skipped

Primary evidence locations:

- Provider-facing live suite: `src/integrations/provider-facing/tier1ProviderFacing.test.ts`
- Provider-facing workflow: `.github/workflows/provider-facing-connectors.yml`
- Connector launch contract notes: `docs/tier1-provider-facing-connectors.md`

## Readiness rubric

Legend
- `pass` — requirement has direct automated evidence and no open hardening dependency
- `blocked` — requirement depends on an open sibling issue or missing environment evidence
- `fail` — required scope or implementation is missing

### Implemented connector matrix

| Connector | Deployment | Auth | Health states | Retry / rate-limit | SDK `v1` | Integration tests | Launch gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `apollo` | `blocked` — `ALT-1942` open | `blocked` — live credential proof pending in `ALT-1943` | `blocked` — standard model pending in `ALT-1945` | `blocked` — standard policy pending in `ALT-1944` | `blocked` — contract freeze pending in `ALT-1947` | `blocked` — unit tests pass; live provider suite blocked in `ALT-1948` | `blocked` |
| `gmail` | `blocked` — `ALT-1942` open | `blocked` — live credential proof pending in `ALT-1943` | `blocked` — standard model pending in `ALT-1945` | `blocked` — standard policy pending in `ALT-1944` | `blocked` — contract freeze pending in `ALT-1947` | `blocked` — unit tests pass; live provider suite blocked in `ALT-1948` | `blocked` |
| `hubspot` | `blocked` — `ALT-1942` open | `blocked` — live credential proof pending in `ALT-1943` | `blocked` — standard model pending in `ALT-1945` | `blocked` — standard policy pending in `ALT-1944` | `blocked` — contract freeze pending in `ALT-1947` | `blocked` — unit tests pass; live provider suite blocked in `ALT-1948` | `blocked` |
| `linear` | `blocked` — `ALT-1942` open | `blocked` — live credential proof pending in `ALT-1943` | `blocked` — standard model pending in `ALT-1945` | `blocked` — standard policy pending in `ALT-1944` | `blocked` — contract freeze pending in `ALT-1947` | `blocked` — unit tests pass; live provider suite blocked in `ALT-1948` | `blocked` |
| `sentry` | `blocked` — `ALT-1942` open | `blocked` — live credential proof pending in `ALT-1943` | `blocked` — standard model pending in `ALT-1945` | `blocked` — standard policy pending in `ALT-1944` | `blocked` — contract freeze pending in `ALT-1947` | `blocked` — unit tests pass; live provider suite blocked in `ALT-1948` | `blocked` |
| `slack` | `blocked` — `ALT-1942` open | `blocked` — live credential proof pending in `ALT-1943` | `blocked` — standard model pending in `ALT-1945` | `blocked` — standard policy pending in `ALT-1944` | `blocked` — contract freeze pending in `ALT-1947` | `blocked` — unit tests pass; live provider suite blocked in `ALT-1948` | `blocked` |
| `stripe` | `blocked` — `ALT-1942` open | `blocked` — live credential proof pending in `ALT-1943` | `blocked` — standard model pending in `ALT-1945` | `blocked` — standard policy pending in `ALT-1944` | `blocked` — contract freeze pending in `ALT-1947` | `blocked` — unit tests pass; live provider suite blocked in `ALT-1948` | `blocked` |
| `teams` | `blocked` — `ALT-1942` open | `blocked` — live credential proof pending in `ALT-1943` | `blocked` — standard model pending in `ALT-1945` | `blocked` — standard policy pending in `ALT-1944` | `blocked` — contract freeze pending in `ALT-1947` | `blocked` — unit tests pass; live provider suite blocked in `ALT-1948` | `blocked` |

### PRD scope discrepancy

| PRD connector | Repository state | QA status |
| --- | --- | --- |
| `jira` | No connector implementation found under `src/integrations/jira` | `fail` |
| `teams` | Fully implemented connector plus provider-facing suite coverage | `blocked` pending prerequisite hardening work |

## Sign-off checklist

Required evidence block
- Ticket: `ALT-1949`
- Reviewer:
- Commit SHA:
- Branch or PR:
- CI run link:
- Deployed URL:
- Deployment timestamp:
- Smoke validation timestamp:

Checklist
- [ ] Tier 1 scope is reconciled between PRD, code, and provider-facing suites.
- [ ] Deployment evidence is present for all Tier 1 connectors from the staging pipeline.
- [ ] Real-credential OAuth verification passed for all Tier 1 connectors.
- [ ] Standard health-state behavior is implemented and verified for all Tier 1 connectors.
- [ ] Standard retry and rate-limit behavior is implemented and verified for all Tier 1 connectors.
- [ ] SDK `v1` contract freeze and contract tests are complete.
- [ ] Provider-facing live suite passed with all required secrets and fixtures configured.
- [ ] Non-local deployed smoke validation matches the commit under review.
- [ ] CTO sign-off recorded.
- [ ] CEO sign-off recorded.

Sign-off decision
- `do not ship` until every checklist item above is complete and every matrix row is green.

Revision history
- `2026-04-28` — Initial QA launch-readiness matrix created for `ALT-1949`. Captured passing connector unit-test evidence, blocked live-provider evidence, and the `Jira` versus `Teams` scope conflict.
