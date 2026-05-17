BEGIN;

-- Add a per-workspace secret used to sign outbound webhook deliveries.
-- Generated at workspace creation; stored as a 32-byte hex string.
-- Receivers verify via X-AutoFlow-Signature: sha256=<hmac>.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS outbound_webhook_secret TEXT;

COMMIT;
