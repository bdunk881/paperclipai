# Ticketing System QA Plan

Purpose
- Define the QA gate for the ticketing system program tracked by `ALT-1694` and the cross-cutting QA task `ALT-1705`.
- Establish milestone-by-milestone test plans before engineering sign-off, with clear automated coverage targets and release evidence requirements.
- Prevent milestone closure without matching backend coverage, dashboard E2E coverage, and documented manual validation for the user-facing surfaces.

Scope
- Parent PRD: `ALT-1694` Agent Ticketing and Memory System.
- QA umbrella task: `ALT-1705`.
- Engineering milestones covered:
  - Milestone 1: `ALT-1695`, `ALT-1696`
  - Milestone 2: `ALT-1698`, `ALT-1699`, `ALT-1700`
  - Milestone 3: `ALT-1701`, `ALT-1702`
  - Milestone 4: `ALT-1703`, `ALT-1704`

Current State
- As of `2026-04-23`, `master` does not yet contain the full ticketing implementation surface described in the PRD.
- This document therefore defines the QA plan, coverage map, and sign-off gates that implementation tickets must satisfy as code lands.
- Automated tests should be added incrementally on the milestone branches that introduce the corresponding behavior, then merged with the implementation.

Ownership
- Owner: QA Engineer
- Contributors: Backend Engineer, Frontend Engineer, AI/ML Engineer, Integrations Engineer, DevOps Engineer
- Reviewers for milestone sign-off: QA Engineer plus the milestone implementer

Test Layers
- API and integration tests: Node/Jest coverage in `src/**/*.test.ts` for ticket lifecycle, memory hooks, SLA logic, and sync behavior.
- Dashboard component tests: Vitest coverage in `dashboard/src/**/*.test.tsx` for isolated UI state and edge cases where Playwright is too expensive.
- Dashboard E2E tests: Playwright coverage in `dashboard/e2e/*.spec.ts` running against the mocked dashboard runtime unless a deployed validation pass is required.
- Manual smoke validation: deployed environment checks for milestone completion when the work is labeled `feature` or `customer-facing`.

Global Quality Gates
- No milestone is marked complete until its milestone-specific test plan items are implemented or explicitly waived in the ticket comments by QA.
- Every mutating backend ticketing route must have success, validation-failure, auth-failure, and audit-trail assertions.
- Every user-visible ticketing flow must have at least one Playwright happy-path test and one negative-path assertion where failure handling is user-visible.
- New test files must be wired into the existing CI entry points rather than relying on local-only execution.
- Milestone sign-off evidence must include:
  - passing automated test command output or CI link
  - deployed URL for customer-facing work
  - commit SHA
  - deployment timestamp
  - smoke-validation result

Milestone 1
- Goal: core ticketing foundation.
- Tickets: `ALT-1695`, `ALT-1696`

Backend coverage required
- Ticket create path with required fields, generated ID, `open` status, and audit event.
- Ticket read and list paths with actor/team filtering.
- Assignment model with exactly one primary assignee and optional collaborators.
- Status transitions: `open -> in_progress -> resolved|blocked|cancelled`.
- Activity stream persistence for comments, state changes, and reassignment events.
- Validation failures for malformed assignee payloads, invalid status values, and missing required inputs.

Frontend and E2E coverage required
- Create ticket modal for agent-only, human-only, and mixed assignee tickets.
- Ticket detail view renders metadata, activity stream, and assignment state.
- Team view shows ticket counts by status.
- Actor view filters a single actor queue by status and priority.
- User-visible validation errors for missing title, missing primary assignee, and invalid submit state.

Manual validation
- Create a ticket from the deployed UI and verify it appears in team and actor views.
- Reassign primary ownership and confirm the activity stream reflects the change.
- Resolve and block a ticket from the UI and verify badge/state updates.

Suggested automation targets
- `src/ticketing/routes.test.ts`
- `src/ticketing/service.test.ts`
- `dashboard/e2e/ticketing-core.spec.ts`

Milestone 2
- Goal: collaboration and agent memory.
- Tickets: `ALT-1698`, `ALT-1699`, `ALT-1700`

Backend coverage required
- Mention creation wakes the addressed actor and records a notification event.
- Child ticket creation links parent and child activity correctly.
- Collaborator `ready_to_close` proposal is stored and visible to the primary assignee.
- Memory entry creation on close for each agent assignee.
- Memory retrieval at ticket start returns only relevant prior entries for the assigned agent.
- Failed memory writes do not block close, produce retryable audit entries, and preserve eventual consistency behavior.

Frontend and E2E coverage required
- Mention composer and mention rendering in ticket updates.
- Child ticket creation from a parent ticket and parent-child status visibility.
- Ready-to-close proposal flow with accept and reject outcomes by the primary assignee.
- Memory sidebar rendering, loading, empty state, and surfaced prior-context snippets.
- Close flow shows memory-write failures or retry state when surfaced to the user.

Manual validation
- Mention another actor and confirm the notification/wake behavior is emitted.
- Create a child ticket from an active parent and verify linkage in both directions.
- Close a multi-agent ticket and verify each agent receives a separate memory entry.

Suggested automation targets
- `src/ticketing/collaboration.test.ts`
- `src/memory/ticketMemoryHooks.test.ts`
- `dashboard/e2e/ticketing-collaboration.spec.ts`

Milestone 3
- Goal: SLA enforcement, dashboard visibility, and escalation.
- Tickets: `ALT-1701`, `ALT-1702`

Backend coverage required
- SLA deadline calculation by priority for first response and resolution windows.
- Clock pause and resume behavior for creator-paused blocked tickets.
- `at_risk` transition at 75 percent of the active window.
- `breached` transition at 100 percent of the active window.
- Notify escalation behavior.
- Optional auto-bump and auto-reassign behavior when enabled.
- Timer accuracy for urgent tickets under sub-hour windows.

Frontend and E2E coverage required
- Ticket badge/state rendering for `on_track`, `at_risk`, `breached`, and `paused`.
- SLA dashboard summary cards and per-actor/per-priority breakdowns.
- Policy editor create, edit, and save flow.
- Escalation builder for notify, auto-bump, and auto-reassign configuration.
- User-visible warning states for invalid policy combinations or save failures.

Manual validation
- Force an urgent ticket into at-risk and breached states in a deployed environment.
- Verify policy editor changes affect newly created tickets.
- Confirm breach notifications reach the intended target.

Suggested automation targets
- `src/ticketing/sla.test.ts`
- `src/ticketing/escalation.test.ts`
- `dashboard/e2e/ticketing-sla.spec.ts`

Milestone 4
- Goal: external sync and workspace-level tracker configuration.
- Tickets: `ALT-1703`, `ALT-1704`

Backend coverage required
- Outbound create-sync to Jira, Linear, and GitHub Issues.
- Update-sync for status, assignee, priority, labels, and comments.
- Inbound sync creates or updates AutoFlow tickets according to configured mode.
- Echo suppression or source-of-change handling prevents update loops.
- Retry and backoff behavior for transient sync failures.
- Sync error state is persisted and recoverable after a successful retry.
- Field mapping honors per-workspace override rules.

Frontend and E2E coverage required
- Tracker connection setup for each supported external system.
- Field mapping UI create and edit flow.
- Sync status badge and latest error visibility on the ticket detail view.
- Workspace settings show configured connections and sync mode.
- User-visible recovery path after a sync failure.

Manual validation
- Connect a tracker in a deployed environment and create a mirrored ticket.
- Update the AutoFlow ticket and verify the mapped external issue changes.
- Update the external issue and verify the AutoFlow ticket reflects the change without an echo loop.

Suggested automation targets
- `src/ticketing/syncEngine.test.ts`
- `src/integrations/{jira,linear,github}/ticketSync.test.ts`
- `dashboard/e2e/ticketing-sync.spec.ts`

Regression Suite
- Minimum regression set before any ticketing release candidate:
  - create ticket
  - assign primary and collaborator
  - post update
  - transition to blocked and resolved
  - render team and actor queues
  - memory-on-close path
  - SLA at-risk and breach indicators
  - external sync success path
  - external sync failure and retry path
- The regression suite should be runnable in two bands:
  - fast local/CI band for backend plus mocked dashboard behavior
  - deployed smoke band for customer-facing validation

Execution Procedure
- Step 1: QA reviews the milestone ticket scope before engineering marks it complete.
- Step 1.5: QA copies the relevant section from `docs/operational/processes/ticketing-system-milestone-signoff-checklist.md` into the milestone review workflow and fills in the required evidence block.
- Step 2: QA confirms the required backend and frontend tests were added in the milestone PR or branch.
- Step 3: QA runs the relevant automated test commands.
- Step 4: For `feature` or `customer-facing` work, QA validates the deployed artifact and records URL, SHA, timestamp, and smoke result.
- Step 5: QA comments on the milestone ticket with pass/fail evidence and either allows sign-off or returns the ticket to `in_progress`.

Baseline Commands
- Backend: `npm test -- --runInBand`
- Backend targeted: `npm test -- --runInBand src/ticketing`
- Dashboard unit tests: `cd dashboard && npm test`
- Dashboard E2E: `cd dashboard && npm run e2e`

Exit Criteria For ALT-1705
- A test plan exists for each milestone and is stored in-repo.
- Each milestone implementation lands with the required automated coverage.
- Each milestone is explicitly QA-signed-off with evidence in its ticket thread.
- A final regression pass completes before the parent launch is considered ready.

Revision History
- 2026-04-23: Created initial ticketing-system-qa-plan.md for `ALT-1705`.
- 2026-04-23: Linked the milestone sign-off checklist for ticket-level QA execution.
