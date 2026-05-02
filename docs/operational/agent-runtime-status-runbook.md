# Agent Runtime Status Runbook

> Written after incident ALT-2209 (2026-05-02). Updates the understanding established in ALT-2194 / ALT-2205.

## How `agents.status` is computed

The dashboard `status` field returned by `GET /api/agents/{id}` and `GET /api/companies/{id}/agents` is **not stored** — it is derived at read time by `toDashboardAgentStatus()` in `src/agents/agentRoutes.ts`:

| Condition | Dashboard `status` |
|---|---|
| `agent.status === "paused"` | `"paused"` |
| `agent.status === "terminated"` | `"idle"` |
| `agent.lastHeartbeatStatus === "blocked"` | `"error"` |
| `agent.lastHeartbeatStatus === "running"` | `"running"` |
| anything else | `"idle"` |

`lastHeartbeatStatus` is updated by `recordHeartbeat()` in `src/controlPlane/controlPlaneStore.ts` each time the control-plane heartbeat endpoint is called. Valid values: `"queued"`, `"running"`, `"completed"`, `"blocked"`.

## What causes `status: error`

Two sources, with very different meanings:

### Real error — budget enforcement
`applyBudgetPolicies()` (controlPlaneStore.ts ~line 1342) sets `lastHeartbeatStatus = "blocked"` when an agent exceeds its spend budget. This is a genuine signal: the agent is paused and will not run until the budget is reset or the policy is changed.

### Cosmetic error — server restart stale state
After a server restart, the runtime may set `lastHeartbeatStatus = "blocked"` for agents that were mid-run. If the agent's next successful heartbeat run does not correctly reach `recordHeartbeat()`, the stored value stays `"blocked"` indefinitely even though the agent is functionally healthy.

**How to tell the difference:**

1. Check `lastHeartbeatAt`. If it is within the last `2 × intervalSec` (default 30 min), the agent is firing heartbeats — `status: error` is cosmetic.
2. Check `runtimeConfig.heartbeat.enabled`. If `true` and heartbeats are landing, the agent is healthy.
3. Check `lifecycleStatus`. If `null`, no lifecycle issue is recorded.

## Sweep routine guard (ALT-2202)

The Daily Errored-Agent Sweep (routine `86b4a686-0ba1-46b2-a3a0-d9bfe63bb05d`) includes a freshness guard shipped in ALT-2211:

```
threshold = now - (2 × intervalSec)   # defaults to 900s when intervalSec is missing
SKIP agent if lastHeartbeatAt > threshold
```

Agents that fired a heartbeat within two intervals are treated as healthy and are **not** touched, regardless of `status`. Only genuinely stale agents (no recent heartbeat) proceed to recovery.

## Platform fix (ALT-2210)

Shipped on 2026-05-02 via PR #451 (`feat/ALT-2210-heartbeat-workspace-fix`):

- `src/controlPlane/controlPlaneRoutes.ts`: heartbeat POST endpoint now resolves and forwards `workspaceId` + `userId` to `recordHeartbeat()`.
- `src/controlPlane/controlPlaneStore.ts`: `recordHeartbeat()` accepts the workspace context so that `lastHeartbeatStatus` is correctly updated to `"completed"` on successful runs, clearing any stale `"blocked"` value.

After this fix, a server-restart-induced `status: error` self-corrects on the next successful heartbeat run. No manual SQL reset is needed.

## Incident response decision tree

```
Agent shows status: error
         │
         ├─► lastHeartbeatAt fresh (< 2× intervalSec)?
         │       YES → cosmetic; no action needed; will auto-clear next run
         │       NO  → continue ↓
         │
         ├─► runtimeConfig.heartbeat.enabled = false?
         │       YES → agent intentionally paused; re-enable if warranted
         │       NO  → continue ↓
         │
         ├─► budget exhausted (check agent budget dashboard)?
         │       YES → reset budget or adjust policy via controlPlane
         │       NO  → continue ↓
         │
         └─► runtime crash / stuck process?
                 YES → restart adapter; lastHeartbeatStatus will self-correct
```

## Do NOT do this

- **Do not** run a manual SQL `UPDATE agents SET lastHeartbeatStatus = 'completed'` without first confirming the agent is genuinely healthy via `lastHeartbeatAt` freshness. That was the pre-fix workaround. The platform fix (ALT-2210) eliminates the need.
- **Do not** trigger ALT-2202 recovery manually for agents with fresh heartbeats. The sweep guard blocks this automatically, but a manual run bypasses it.
