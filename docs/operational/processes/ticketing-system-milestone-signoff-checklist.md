# Ticketing System Milestone Sign-Off Checklist

Purpose
- Provide a repeatable QA sign-off template for ticketing milestones under `ALT-1705`.
- Ensure each milestone records the same evidence set before being allowed to stay in `done` or `in_review`.

How To Use
- Copy the relevant milestone section into the implementation ticket comment thread when QA review starts.
- Mark each line `pass`, `fail`, or `waived`.
- Record concrete evidence for every `pass` result: test command, CI link, deployed URL, commit SHA, and timestamp where applicable.
- If any required item fails, return the implementation ticket to `in_progress` with the missing evidence or defect details.

Required Evidence Block
- Ticket:
- Milestone:
- QA reviewer:
- Commit SHA:
- Branch or PR:
- CI run link:
- Deployed URL:
- Deployment timestamp:
- Smoke validation timestamp:

Milestone 1 Sign-Off
- Scope: `ALT-1695`, `ALT-1696`
- Status:

Checklist
- [ ] Backend create/read/list/update paths are covered by automated tests.
- [ ] Assignment rules enforce one primary assignee and optional collaborators.
- [ ] Ticket state transitions are covered for `open`, `in_progress`, `resolved`, `blocked`, and `cancelled`.
- [ ] Activity stream persistence is covered for status changes and reassignment.
- [ ] Dashboard create-ticket flow passes in Playwright.
- [ ] Ticket detail, team view, and actor view render correctly in Playwright.
- [ ] User-visible validation errors were exercised for invalid create flow input.
- [ ] Deployed smoke validation confirms ticket creation, reassignment, and close-state behavior.

Defects Or Follow-Ups
- None recorded:

Milestone 2 Sign-Off
- Scope: `ALT-1698`, `ALT-1699`, `ALT-1700`
- Status:

Checklist
- [ ] Mention handling is covered by automated backend tests.
- [ ] Child ticket linkage is covered by automated backend tests.
- [ ] `ready_to_close` proposal flow is covered by automated tests.
- [ ] Per-agent memory write on close is covered by automated tests.
- [ ] Failed memory write and retry behavior is covered by automated tests.
- [ ] Memory retrieval at ticket start is covered by automated tests.
- [ ] Collaboration UI, memory sidebar, and close flow pass in Playwright.
- [ ] Deployed smoke validation confirms mention, child ticket, and memory behaviors.

Defects Or Follow-Ups
- None recorded:

Milestone 3 Sign-Off
- Scope: `ALT-1701`, `ALT-1702`
- Status:

Checklist
- [ ] SLA deadline calculation is covered for all priority levels.
- [ ] Pause and resume behavior is covered for creator-paused blocked tickets.
- [ ] `at_risk` and `breached` transitions are covered by automated tests.
- [ ] Notify escalation is covered by automated tests.
- [ ] Auto-bump and auto-reassign are covered when enabled.
- [ ] SLA badge and dashboard views pass in Playwright.
- [ ] Policy editor and escalation builder pass in Playwright.
- [ ] Deployed smoke validation confirms the visible at-risk or breached state and policy application.

Defects Or Follow-Ups
- None recorded:

Milestone 4 Sign-Off
- Scope: `ALT-1703`, `ALT-1704`
- Status:

Checklist
- [ ] Outbound create-sync is covered for Jira, Linear, and GitHub Issues.
- [ ] Update-sync is covered for status, assignee, priority, labels, and comments.
- [ ] Inbound sync creation or update behavior is covered by automated tests.
- [ ] Echo suppression or source-of-change protection is covered by automated tests.
- [ ] Sync retry and error-state handling is covered by automated tests.
- [ ] Tracker connection setup and field mapping pass in Playwright.
- [ ] Sync status and sync error visibility pass in Playwright.
- [ ] Deployed smoke validation confirms create-sync, update-sync, and non-echo inbound update behavior.

Defects Or Follow-Ups
- None recorded:

Release Candidate Regression Sign-Off
- Status:

Checklist
- [ ] Create ticket regression passes.
- [ ] Assign primary and collaborator regression passes.
- [ ] Update and activity-stream regression passes.
- [ ] Blocked and resolved transition regression passes.
- [ ] Team and actor queue regression passes.
- [ ] Memory-on-close regression passes.
- [ ] SLA indicator regression passes.
- [ ] External sync success regression passes.
- [ ] External sync failure and retry regression passes.
- [ ] Deployment-proof evidence is present for the release candidate.

Defects Or Follow-Ups
- None recorded:

Revision History
- 2026-04-23: Created milestone sign-off checklist for `ALT-1705`.
