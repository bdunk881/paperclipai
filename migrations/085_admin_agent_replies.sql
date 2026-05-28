-- HEL Infra Dashboard PR #8: async agent-ask reply receive
-- ---------------------------------------------------------
-- Webhooks that want to send the agent's answer back asynchronously POST
-- to the `callback_url` we returned in the original Ask-an-Agent payload.
-- This table stores those replies so the UI can render them inline on the
-- originating tile / row / metric without polling.
--
-- HMAC verification happens at the route level (using the webhook's stored
-- secret); rows here only land if the inbound POST was signed correctly.

CREATE TABLE IF NOT EXISTS admin_agent_replies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ask_id             uuid NOT NULL REFERENCES admin_agent_asks(id) ON DELETE CASCADE,
  body               text NOT NULL,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at        timestamptz NOT NULL DEFAULT NOW(),
  /* Captures whether the inbound signature verified — we only insert when
     true, but track it so retroactive auditing can prove the property. */
  signature_verified boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS admin_agent_replies_ask_received_idx
  ON admin_agent_replies (ask_id, received_at DESC);

COMMENT ON TABLE admin_agent_replies IS
  'Async replies to Ask-an-Agent webhooks (HEL infra dashboard PR #8). HMAC-verified at insert time.';
