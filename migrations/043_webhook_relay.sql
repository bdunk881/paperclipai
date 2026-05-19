-- DASH-51: persist webhook relay subscriptions + events.
--
-- Pre-DASH-51 src/integrations/webhookRelay.ts held all subscription registrations
-- and the per-subscription event buffer in two in-process Maps. Every Fly
-- restart wiped them — the user's relay URLs effectively expired (the
-- subscription record was gone, so /api/webhooks/relay/:subscriptionId 404'd
-- on every inbound event after a deploy).
--
-- Events table is sized for the same MAX_EVENTS_PER_SUBSCRIPTION = 500
-- circular-buffer behavior the in-memory implementation provided; the store
-- prunes oldest rows beyond that ceiling on every ingest.

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id                       uuid PRIMARY KEY,
  user_id                  text NOT NULL,
  integration_slug         text NOT NULL,
  trigger_id               text NOT NULL,
  event_types              jsonb NOT NULL DEFAULT '[]'::jsonb,
  workflow_template_id     text,
  label                    text NOT NULL,
  active                   boolean NOT NULL DEFAULT true,
  signature_scheme         text NOT NULL DEFAULT 'none' CHECK (
    signature_scheme IN ('stripe', 'hubspot', 'github', 'hmac-sha256', 'none')
  ),
  signing_secret           text,
  signature_header_key     text,
  last_fired_at            timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_user
  ON webhook_subscriptions (user_id, integration_slug);


CREATE TABLE IF NOT EXISTS webhook_relayed_events (
  id                       uuid PRIMARY KEY,
  subscription_id          uuid NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  user_id                  text NOT NULL,
  integration_slug         text NOT NULL,
  trigger_id               text NOT NULL,
  payload                  jsonb NOT NULL,
  headers                  jsonb NOT NULL,
  consumed                 boolean NOT NULL DEFAULT false,
  received_at              timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_relayed_events_subscription
  ON webhook_relayed_events (subscription_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_relayed_events_consumed
  ON webhook_relayed_events (subscription_id, consumed, received_at DESC);
