# Agent Runtime Status Runbook

> Written after incident ALT-2209 (2026-05-02). Corrected after CEO re-open on 2026-05-02 — original version mis-described `agents.status` as derived; it is stored.

## Two separate status systems — do not confuse them

### 1. Paperclip platform `agents.status` (stored)

`GET /api/agents/{id}` returns `status` as a **raw stored column** in the Paperclip platform database. Valid values: `"active"`, `"error"`, `"paused"`, `"terminated"`.

This field is set by the platform on run failures / server restarts. It does **not** auto-clear when subsequent runs succeed — that is the bug tracked in [ALT-2224](/ALT/issues/ALT-2224).

### 2. AutoFlow app dashboard status (derived)

The AutoFlow app's `GET /api/agents/` list route derives a display status via `toDashboardAgentStatus()` in `src/agents/agentRoutes.ts`:

| Condition | Display `status` |
|---|---|
| `agent.status === "paused"` | `"paused"` |
| `agent.status === "terminated"` | `"idle"` |
| `agent.lastHeartbeatStatus === "blocked"` | `"error"` |
| `agent.lastHeartbeatStatus === "running"` | `"running"` |
| anything else | `"idle"` |

`lastHeartbeatStatus` is updated by `recordHeartbeat()` in `src/controlPlane/controlPlaneStore.ts`.

## What causes `agents.status: error` (Paperclip API)

1. **Server restart** — platform sets `status = "error"` for agents that were mid-run when the process died.
2. **Run hard failure** — a heartbeat run exits abnormally and the platform records the error.
3. **Budget block** — `applyBudgetPolicies()` may set status when spend limits are exceeded.

**None of these auto-clear today.** ALT-2224 tracks the platform fix.

## How to tell cosmetic vs real error

1. Check `lastHeartbeatAt`. If it is within `2 × intervalSec` (default 30 min), the agent is firing successfully — the `status: error` is cosmetic/stale.
2. Check `runtimeConfig.heartbeat.enabled`. If `true` and heartbeats are landing, the agent is healthy.
3. Check `lifecycleStatus`. If `null`, no lifecycle issue is active.

## Immediate remediation (manual, until ALT-2224 ships)

```bash
# Clear a stuck agent — safe when lastHeartbeatAt is fresh
curl -X PATCH "$PAPERCLIP_API_URL/api/agents/{agentId}" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "active"}'
```

Do this for each agent with `status: error` and fresh `lastHeartbeatAt`. Confirm with a follow-up GET.

## Sweep routine guard (ALT-2202)

The Daily Errored-Agent Sweep (routine `86b4a686-0ba1-46b2-a3a0-d9bfe63bb05d`) includes a freshness guard shipped in ALT-2211:

```
threshold = now - (2 × intervalSec)   # defaults to 900s when intervalSec is missing
SKIP agent if lastHeartbeatAt > threshold
```

Agents with a recent heartbeat are **not** touched regardless of `status`. This prevents phantom recovery work until ALT-2224 ships.

## Platform fix pending (ALT-2224)

[ALT-2224](/ALT/issues/ALT-2224) — platform auto-reset of `agents.status` from `"error"` to `"active"` on successful heartbeat run. Once this ships, the manual PATCH workaround is no longer needed.

## AutoFlow control-plane fix (ALT-2210)

PR #451 (`feat/ALT-2210-heartbeat-workspace-fix`) fixed workspace context forwarding in `recordHeartbeat()`. This addressed a scoping bug in the AutoFlow control plane but does **not** affect the Paperclip platform's stored `agents.status`. Both fixes are needed; ALT-2210 is complete, ALT-2224 is pending.

## Incident response decision tree

```
Agent shows status: error (Paperclip API)
         │
         ├─► lastHeartbeatAt fresh (< 2× intervalSec)?
         │       YES → cosmetic stale state
         │             → PATCH /api/agents/{id} { status: "active" } to clear now
         │             → ALT-2224 will make this self-healing; track there
         │       NO  → continue ↓
         │
         ├─► runtimeConfig.heartbeat.enabled = false?
         │       YES → agent intentionally paused; re-enable if warranted
         │       NO  → continue ↓
         │
         ├─► budget exhausted?
         │       YES → reset budget or adjust policy
         │       NO  → continue ↓
         │
         └─► runtime crash / stuck process?
                 YES → restart adapter; manually PATCH status after next successful run
```

## Do NOT do this

- **Do not** assume `status: error` means the agent is broken without first checking `lastHeartbeatAt`. Fresh heartbeat = cosmetic error.
- **Do not** run the ALT-2202 sweep manually on agents with fresh heartbeats — the guard blocks it on the scheduled run but a manual trigger bypasses it.
- **Do not** close a bug fix for this class of issue without live verification: query `GET /api/agents/{id}` and confirm `status` is no longer `"error"` after the fix is deployed.
