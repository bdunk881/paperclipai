# HITL Backend Contracts

This document defines the backend contract surface for human-in-the-loop checkpoints, inline artifact comments, and `Ask the CEO`.

## Base route

All endpoints are mounted under `/api/hitl` and require standard dashboard authentication.

Mutating routes also require:

```http
X-Paperclip-Run-Id: <run-id>
```

## Company checkpoint schedule

### `GET /api/hitl/companies/:companyId/checkpoint-schedule`

Returns the effective schedule for a company. If no custom schedule exists yet, the backend returns a default schedule.

Default behavior:

- Weekly review: Friday at 16:00 UTC
- Milestone gate statuses: `at_risk`, `ready_for_review`, `blocked`
- KPI deviation thresholds: empty until configured
- Notification channels: `inbox`, `agent_wake`

### `PUT /api/hitl/companies/:companyId/checkpoint-schedule`

Accepts a partial update:

```json
{
  "timezone": "America/New_York",
  "weeklyReview": {
    "dayOfWeek": 4,
    "hour": 15
  },
  "milestoneGate": {
    "blockingStatuses": ["ready_for_review", "blocked"]
  },
  "kpiDeviation": {
    "thresholds": [
      {
        "metricKey": "weekly_signups",
        "comparator": "lt",
        "threshold": 100,
        "window": "week"
      }
    ]
  }
}
```

## Checkpoints

### `GET /api/hitl/companies/:companyId/checkpoints`

Optional query:

- `status=pending|acknowledged|resolved|dismissed`

### `POST /api/hitl/companies/:companyId/checkpoints`

Creates a manual or system-authored checkpoint.

```json
{
  "triggerType": "manual",
  "title": "Review HITL backlog",
  "description": "Optional",
  "dueAt": "2026-04-30T17:00:00.000Z",
  "artifactRefs": ["ticket://ALT-1917"],
  "recipientType": "user",
  "recipientId": "user-123"
}
```

### `POST /api/hitl/companies/:companyId/checkpoints/evaluate-trigger`

This is the contract entrypoint for automation and schedulers. It evaluates a default trigger and opens a checkpoint when the event matches the configured policy.

Supported `triggerType` values:

- `end_of_week_review`
- `milestone_gate`
- `kpi_deviation`

Example:

```json
{
  "triggerType": "kpi_deviation",
  "recipientType": "agent",
  "recipientId": "ceo-agent",
  "event": {
    "metricKey": "weekly_signups",
    "observedValue": 74
  }
}
```

Response:

```json
{
  "matched": true,
  "reason": "observedValue breached the configured KPI threshold",
  "checkpoint": {
    "id": "uuid",
    "triggerType": "kpi_deviation",
    "status": "pending"
  }
}
```

Trigger semantics:

- `end_of_week_review`: opens a checkpoint when `evaluatedAt` lands on the configured `weeklyReview.dayOfWeek`
- `milestone_gate`: opens a checkpoint when the event `status` matches a configured `blockingStatuses` value
- `kpi_deviation`: opens a checkpoint when `observedValue` breaches the configured comparator and threshold for `metricKey`

## Inline artifact comments

### `GET /api/hitl/companies/:companyId/artifact-comments`

Optional query:

- `artifactId=<artifact-id>`
- `status=open|resolved`

### `POST /api/hitl/companies/:companyId/artifact-comments`

Creates a routed inline comment anchored to an artifact location.

```json
{
  "artifact": {
    "kind": "document",
    "id": "prd-1",
    "title": "Launch PRD",
    "path": "/docs/prd.md"
  },
  "anchor": {
    "quote": "Ask the CEO should include citations",
    "lineStart": 18,
    "lineEnd": 18
  },
  "body": "Please add the company-state evidence block before this ships.",
  "routing": {
    "recipientType": "agent",
    "recipientId": "backend-engineer",
    "responsibleAgentId": "backend-engineer",
    "reason": "Backend owns the Ask the CEO response contract."
  }
}
```

## Ask the CEO

### `POST /api/hitl/companies/:companyId/ask-ceo/requests`

Creates a question and returns an answered response payload with citations and company-state versioning.

```json
{
  "question": "What needs my attention right now?",
  "context": {
    "checkpointId": "uuid"
  }
}
```

The response includes:

- `summary`
- `recommendedActions`
- `citedEntities`
- `companyStateVersion`

### `GET /api/hitl/companies/:companyId/ask-ceo/requests/:requestId`

Returns a previously created request and response envelope.

## Company state

### `GET /api/hitl/companies/:companyId/state`

Returns the aggregated company state snapshot that `Ask the CEO` cites:

- current control-plane team metadata when `companyId` maps to an existing team
- open task count
- active execution count
- checkpoint schedule
- checkpoints
- unresolved artifact comments
- prior `Ask the CEO` requests

## Notifications

### `GET /api/hitl/companies/:companyId/notifications`

Optional query:

- `recipientType=agent|user`
- `recipientId=<id>`
- `kind=checkpoint|artifact_comment|ask_ceo_response`

Notification payloads are emitted for:

- newly created checkpoints
- routed artifact comments
- completed `Ask the CEO` answers
