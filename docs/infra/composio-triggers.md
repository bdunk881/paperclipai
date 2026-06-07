# Composio triggers — provisioning & operations runbook (P4 / HEL-725)

How AutoFlow's **dual-source triggers** work, how to wire the Composio side so
events actually arrive, and how to keep subscriptions healthy.

## The pipeline (what happens when a trigger fires)

1. **Subscribe** (P4-a/P4-c, dashboard P4-d): an admin picks a toolkit + trigger
   type, binds it to an agent, and we call `composio.triggers.create(ws_<id>, slug,
   { connectedAccountId, triggerConfig })`. The returned `ti_…` is persisted in
   `composio_trigger_instances` (migration 109) bound to the agent.
2. **Composio POSTs** the event to the **one project webhook** →
   `POST /api/webhooks/composio` (mounted before `express.json()`; the HMAC over
   the raw body is the auth boundary).
3. **Verify + route** (P4-b, `webhookService.ts`): `composio.triggers.verifyWebhook`
   checks the signature. A real trigger self-identifies its tenant via
   `payload.userId = ws_<workspaceId>`; `composioTriggerIngest` resolves the bound
   instance (`trigger_slug` + `connected_account_id` → workspace + agent), resolves
   a workspace member (`app_resolve_workspace_owner`), dedupes by event id, and
   calls `routeEvent(source:"composio_trigger")`.
4. **Wake → run**: the triage engine ACTs on `composio_trigger` by default
   (`triagePolicy.ts`) and the wake dispatcher boots the agent (`executeAgentPrompt`).
   A per-agent `triage_policy` can still narrow this.

> The unified dispatch seam is the **wake/triage engine** — NOT the legacy
> `routines.trigger_kind` enum (its `webhook`/`event` kinds are inert). Native
> scheduled triggers remain as routine cron schedules (the dashboard picker's
> "Scheduled (native)" tab links there).

## One-time setup

### Env (Fly / Infisical)
- `COMPOSIO_ENABLED=true` and `COMPOSIO_API_KEY` — the broker (gates everything).
- `COMPOSIO_WEBHOOK_SECRET` — the HMAC secret shared with the project webhook
  (the SAME secret verifies both `connected_account.expired` and trigger events).
- Public origin vars (so OAuth + callbacks resolve): `DASHBOARD_APP_URL`,
  `COMPOSIO_REDIRECT_BASE_URL` (see [dev-fly-api-env-source]).

### The project webhook (one per Composio project)
In the Composio dashboard (or via their webhook config API), point the project
webhook at:

```
https://<api-origin>/api/webhooks/composio      e.g. https://dev-api.helloautoflow.com/api/webhooks/composio
```

Enable **both** event classes on that subscription:
- `connected_account.*` (lifecycle — P1d marks accounts EXPIRED for re-auth), and
- **trigger events** (so subscribed triggers are delivered here).

Set the webhook signing secret to the value of `COMPOSIO_WEBHOOK_SECRET`. Trigger
events and lifecycle events multiplex over this single endpoint; the handler
branches on the verified payload (`triggerSlug` / `userId`).

## Lifecycle & healing

- **Account expiry**: `connected_account.expired` → the connection is marked
  `EXPIRED` (re-auth needed). Composio disables the account's triggers server-side.
- **After re-auth** (EXPIRED → ACTIVE): run the **reconcile** to surface triggers
  that drifted (got disabled/deleted out-of-band):

  ```ts
  import { reconcileWorkspaceTriggers } from "src/integrations/composio/broker";
  const { checked, drifted } = await reconcileWorkspaceTriggers({ workspaceId, userId });
  ```

  It compares the workspace's local `ENABLED` instances against
  `composio.triggers.listActive({ triggerIds })` and marks any no-longer-active as
  `ERROR` (best-effort; a broker failure is a no-op). The dashboard Triggers tab
  shows `ERROR` rows so an admin can re-subscribe. Wiring this to a periodic job
  and/or the re-auth completion hook is the remaining operational step.

## Verifying end-to-end (dev smoke test)

1. Connect a toolkit (Connections → Integrations).
2. Connections → **Triggers** → subscribe a trigger for that toolkit, bound to an
   agent.
3. Cause the upstream event (e.g. push a commit for `GITHUB_COMMIT_EVENT`).
4. Confirm: a `wake_events` row (`source = composio_trigger`) and an agent run
   (`acted_run_id`) for the bound agent.
