-- HEL Infra Dashboard PR #2: Ask-an-Agent webhook configuration
-- ---------------------------------------------------------------
-- Lets platform admins register outbound webhook receivers (Slack, Zapier,
-- n8n, internal LangGraph endpoints, etc). Each webhook stores an optional
-- HMAC secret encrypted at rest using the existing keyVersionedSecretVault
-- pattern. Custom headers (Authorization etc.) are also encrypted.
--
-- Only platform admins can read / modify rows; the agentWebhookStore in
-- src/adminConsole/agentWebhooks/store.ts enforces this at the application
-- layer (table access already gated by requirePlatformAdmin upstream).

CREATE TABLE IF NOT EXISTS admin_agent_webhooks (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  url                     text NOT NULL,
  hmac_secret_ciphertext  text,
  custom_headers_ciphertext text,
  created_by              uuid NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT NOW(),
  updated_at              timestamptz NOT NULL DEFAULT NOW(),
  last_used_at            timestamptz,
  disabled_at             timestamptz,
  CONSTRAINT admin_agent_webhooks_url_https_chk
    CHECK (url ~* '^https://')
);

CREATE INDEX IF NOT EXISTS admin_agent_webhooks_active_idx
  ON admin_agent_webhooks (created_at DESC)
  WHERE disabled_at IS NULL;

COMMENT ON TABLE admin_agent_webhooks IS
  'Outbound webhook receivers for the Ask-an-Agent feature (HEL infra dashboard PR #2). HMAC secret + custom headers encrypted at rest.';
