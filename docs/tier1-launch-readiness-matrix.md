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

- `ALT-1942` — release-path PR merged, but the issue thread still says deployment proof is pending; no deployed URL or deployment timestamp is recorded in the completion evidence
- `ALT-1943` — live OAuth verification with real credentials is still `in_progress`
- `ALT-1945` — connector health-state model is still `blocked`
- `ALT-1948` — provider-facing suite merged to `staging`, but the merged suite still validates `apollo` instead of required `jira`

Resolved since the previous matrix update:

- `ALT-1944` — merged via PR `#328` on `2026-04-28`
- `ALT-1947` — merged via PR `#329` on `2026-04-28`

Authoritative Tier 1 scope after CTO decision in `ALT-1952`:

- `slack`
- `hubspot`
- `stripe`
- `gmail`
- `sentry`
- `linear`
- `teams`
- `jira`

Current evidence mismatch that still blocks sign-off:

- The merged provider-facing suite on `staging` still covers `apollo` instead of `jira`.
- Jira exists through the tracker-sync adapter path, with shared adapter tests, but it is not yet represented in the live provider-facing gate owned by `ALT-1948`.

## Evidence captured in this QA pass

Automated evidence executed in this heartbeat:

- Connector unit suites passed for implemented Tier 1 connectors:
  - Command: `npm test -- --runInBand src/integrations/apollo/apolloConnector.test.ts src/integrations/gmail/gmailConnector.test.ts src/integrations/hubspot/hubspotConnector.test.ts src/integrations/linear/linearConnector.test.ts src/integrations/sentry/sentryConnector.test.ts src/integrations/slack/slackConnector.test.ts src/integrations/stripe/stripeConnector.test.ts src/integrations/teams/teamsConnector.test.ts`
  - Result: `8` suites passed, `62` tests passed
- Jira tracker-sync evidence passed on the updated master base:
  - Command: `npm test -- --runInBand src/integrations/tracker-sync/trackerSync.test.ts`
  - Result: `1` suite passed, `4` tests passed
- Retry-policy and SDK contract work are now merged on `master`:
  - `ALT-1944` / PR `#328` merged at `2026-04-28T05:56:18Z`
  - `ALT-1947` / PR `#329` merged at `2026-04-28T05:56:21Z`
- Provider-facing suite is merged on `staging`, not `master`:
  - `ALT-1948` / PR `#322` merged to `staging` at `2026-04-28T14:07:19Z`
- Provider-facing live suite was not executable in this local QA heartbeat because required Tier 1 provider secrets were not present:
  - Command: `npm run test:connectors:provider`
  - Result: `1` suite skipped, `30` tests skipped

Primary evidence locations:

- Provider-facing live suite: `src/integrations/provider-facing/tier1ProviderFacing.test.ts`
- Provider-facing workflow: `.github/workflows/provider-facing-connectors.yml`
- Connector launch contract notes: `docs/tier1-provider-facing-connectors.md`
- Jira adapter implementation: `src/integrations/tracker-sync/jiraAdapter.ts`
- Jira shared adapter tests: `src/integrations/tracker-sync/trackerSync.test.ts`

## Readiness rubric

Legend
- `pass` — requirement has direct automated evidence and no open hardening dependency
- `blocked` — requirement depends on an open sibling issue or missing environment evidence
- `fail` — required scope or implementation is missing

### Authoritative Tier 1 matrix

| Connector | Deployment | Auth | Health states | Retry / rate-limit | SDK `v1` | Integration tests | Launch gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `gmail` | `blocked` — `ALT-1942` lacks deployment-proof evidence in the issue thread | `blocked` — live credential proof pending in `ALT-1943` | `blocked` — standard model pending in `ALT-1945` | `pass` — merged retry policy from `ALT-1944` | `pass` — merged SDK `v1` contract from `ALT-1947` | `blocked` — provider-facing suite on `staging` still omits Jira and includes Apollo in `ALT-1948` | `blocked` |
| `hubspot` | `blocked` — `ALT-1942` lacks deployment-proof evidence in the issue thread | `blocked` — live credential proof pending in `ALT-1943` | `blocked` — standard model pending in `ALT-1945` | `pass` — merged retry policy from `ALT-1944` | `pass` — merged SDK `v1` contract from `ALT-1947` | `blocked` — provider-facing suite on `staging` still omits Jira and includes Apollo in `ALT-1948` | `blocked` |
| `jira` | `blocked` — `ALT-1942` lacks deployment-proof evidence in the issue thread | `blocked` — live credential proof pending in `ALT-1943` | `blocked` — health path exists in `JiraAdapter.health()` but standard model is pending in `ALT-1945` | `pass` — merged retry policy from `ALT-1944` plus tracker-sync adapter coverage | `pass` — merged SDK `v1` contract from `ALT-1947` | `blocked` — tracker-sync unit tests pass, but the staged provider-facing gate still omits Jira in `ALT-1948` | `blocked` |
| `linear` | `blocked` — `ALT-1942` lacks deployment-proof evidence in the issue thread | `blocked` — live credential proof pending in `ALT-1943` | `blocked` — standard model pending in `ALT-1945` | `pass` — merged retry policy from `ALT-1944` | `pass` — merged SDK `v1` contract from `ALT-1947` | `blocked` — provider-facing suite on `staging` still omits Jira and includes Apollo in `ALT-1948` | `blocked` |
| `sentry` | `blocked` — `ALT-1942` lacks deployment-proof evidence in the issue thread | `blocked` — live credential proof pending in `ALT-1943` | `blocked` — standard model pending in `ALT-1945` | `pass` — merged retry policy from `ALT-1944` | `pass` — merged SDK `v1` contract from `ALT-1947` | `blocked` — provider-facing suite on `staging` still omits Jira and includes Apollo in `ALT-1948` | `blocked` |
| `slack` | `blocked` — `ALT-1942` lacks deployment-proof evidence in the issue thread | `blocked` — live credential proof pending in `ALT-1943` | `blocked` — standard model pending in `ALT-1945` | `pass` — merged retry policy from `ALT-1944` | `pass` — merged SDK `v1` contract from `ALT-1947` | `blocked` — provider-facing suite on `staging` still omits Jira and includes Apollo in `ALT-1948` | `blocked` |
| `stripe` | `blocked` — `ALT-1942` lacks deployment-proof evidence in the issue thread | `blocked` — live credential proof pending in `ALT-1943` | `blocked` — standard model pending in `ALT-1945` | `pass` — merged retry policy from `ALT-1944` | `pass` — merged SDK `v1` contract from `ALT-1947` | `blocked` — provider-facing suite on `staging` still omits Jira and includes Apollo in `ALT-1948` | `blocked` |
| `teams` | `blocked` — `ALT-1942` lacks deployment-proof evidence in the issue thread | `blocked` — live credential proof pending in `ALT-1943` | `blocked` — standard model pending in `ALT-1945` | `pass` — merged retry policy from `ALT-1944` | `pass` — merged SDK `v1` contract from `ALT-1947` | `blocked` — provider-facing suite on `staging` still omits Jira and includes Apollo in `ALT-1948` | `blocked` |

### Scope alignment note

| Item | Current state | QA impact |
| --- | --- | --- |
| Authoritative Tier 1 scope | Confirmed by CTO in `ALT-1952` as `slack`, `hubspot`, `stripe`, `gmail`, `sentry`, `linear`, `teams`, `jira` | scope decision resolved |
| Live provider-facing gate | Merged to `staging` in PR `#322`, but still exercises `apollo` instead of required `jira` | remains blocked on `ALT-1948` |
| Apollo evidence | Unit and live-suite coverage exists, but Apollo is not part of the current Tier 1 launch gate | excluded from sign-off matrix |

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
- [ ] Tier 1 scope is reflected consistently in the live provider-facing gate and sign-off evidence.
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
- `2026-04-28` — Updated after `ALT-1952`: authoritative scope confirmed as `slack`, `hubspot`, `stripe`, `gmail`, `sentry`, `linear`, `teams`, `jira`; matrix revised to exclude `apollo` from launch sign-off and add Jira tracker-sync evidence.
- `2026-04-28` — Narrowed the blocker set after the CTO refresh: `ALT-1944` and `ALT-1947` are merged and now count as passing evidence, while `ALT-1942` still lacks deployment-proof evidence and `ALT-1948` still validates `apollo` instead of `jira`.
