-- HEL Infra Dashboard PR #2: Ask-an-Agent send history
-- ------------------------------------------------------
-- Every "Ask agent →" click writes a row here BEFORE the outbound POST so
-- that even if the deliverer crashes the receipt survives. status moves
-- from 'pending' → 'sent' (on 2xx) → 'failed' (on non-2xx or transport
-- error). PR #8 (optional follow-up) will add an admin_agent_replies
-- sibling table for async callbacks.

CREATE TABLE IF NOT EXISTS admin_agent_asks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_webhook_id    uuid NOT NULL REFERENCES admin_agent_webhooks(id) ON DELETE RESTRICT,
  admin_user_id       uuid NOT NULL,
  kind                text NOT NULL,
  source              text NOT NULL,
  subject_ref         jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  admin_question      text NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'sent', 'delivered', 'failed')),
  http_status         int,
  response_excerpt    text,
  sent_at             timestamptz NOT NULL DEFAULT NOW(),
  completed_at        timestamptz
);

CREATE INDEX IF NOT EXISTS admin_agent_asks_webhook_sent_idx
  ON admin_agent_asks (agent_webhook_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS admin_agent_asks_admin_sent_idx
  ON admin_agent_asks (admin_user_id, sent_at DESC);

COMMENT ON TABLE admin_agent_asks IS
  'History of Ask-an-Agent webhook deliveries (HEL infra dashboard PR #2). One row per click, written before the outbound POST.';
