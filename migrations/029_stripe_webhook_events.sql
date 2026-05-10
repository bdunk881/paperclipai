-- Migration 029: stripe_webhook_events idempotency table (HEL-67)
--
-- Stripe delivers webhooks at-least-once and not strictly ordered. Without
-- an idempotency record we'd re-apply the same event on retry, and a stale
-- `customer.subscription.updated` arriving after a newer one could overwrite
-- a workspace's entitlements with older state — silent customer downgrade.
--
-- The table records every event Stripe sends us, keyed on `event.id`
-- (Stripe's UUID — guaranteed unique per event). The webhook handler:
--
--   1. INSERT ... ON CONFLICT DO NOTHING. RETURNING xmax = 0 tells us
--      whether we won the insert race (xmax 0 = inserted, non-0 = existed).
--   2. If we LOST the race (already processed) → respond 200 OK, do not
--      re-run the handler.
--   3. If we WON, run the handler. On error, the row stays as a "we tried"
--      marker; the next retry hits the same id and skips. (This is the
--      standard Stripe idempotency pattern — intentional duplicate-suppression
--      even on partial failure, since Stripe retries the WHOLE event and
--      handler partial state is hard to undo cleanly.)
--
-- For ordering: the stored `event_created` (Stripe's `created` timestamp)
-- lets each handler compare incoming event_created against the most-recent
-- one applied for the same subscription_id and short-circuit if older.

BEGIN;

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  -- Stripe's event.id, e.g. "evt_1Ab2CdEfGhIjKlMnOpQrStUv"
  event_id text PRIMARY KEY,
  -- The Stripe event type, e.g. "customer.subscription.updated"
  event_type text NOT NULL,
  -- Stripe's event.created (Unix epoch seconds, normalized to timestamptz).
  -- Drives stale-event short-circuit logic in the handlers.
  event_created timestamptz NOT NULL,
  -- For stale-detection per resource, store the resource id this event
  -- mutates (subscription id, customer id, etc.). Nullable for event types
  -- that don't have a single resource id.
  resource_id text,
  -- When we received and processed it. Useful for ops dashboards.
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- Per-resource ordering: handlers query "most recent event_created for
-- this subscription_id" before applying.
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_resource
  ON stripe_webhook_events (resource_id, event_created DESC)
  WHERE resource_id IS NOT NULL;

-- Recent-events tail (for ops + replay diagnostics).
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed_at
  ON stripe_webhook_events (processed_at DESC);

COMMIT;
