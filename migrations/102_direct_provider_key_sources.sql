-- HEL-600 — direct-provider key sources (Anthropic + OpenAI) for credit routing.
--
-- Phase 2 of the direct-funding project: seed the two direct-provider rows the
-- credits router already knows how to route to. With priority=10 they win over
-- the OpenRouter catch-all (priority=100) for their provider; OpenRouter still
-- catches DeepSeek + the long tail. Migration 069's CHECK already allows
-- source_kind='direct' for any provider — no constraint change.
--
-- Seeded DISABLED with a placeholder ciphertext, because:
--   * key_ciphertext is NOT NULL and a SQL migration cannot hold a real
--     AES-GCM ciphertext (those are produced app-side by connectorSecretVault).
--   * 'disabled' rows are never selected by pickKeySource (the status filter)
--     and therefore never decrypted, so the placeholder is inert + safe.
--
-- Go-live (HEL-618): ops rotates the real provider API key into each row via
-- the admin console (POST /api/admin-console/credits/key-sources/:id/rotate,
-- which re-encrypts), THEN flips status to active. Do NOT enable before
-- rotating — an active row carrying the placeholder ciphertext would fail to
-- decrypt on the hot path. ON CONFLICT keeps this migration idempotent and
-- non-destructive if the rows were already created by hand.

INSERT INTO platform_provider_keys (source_kind, provider, label, key_ciphertext, status, priority)
VALUES
  ('direct', 'anthropic', 'Anthropic direct', '__ROTATE_ME__', 'disabled', 10),
  ('direct', 'openai',    'OpenAI direct',    '__ROTATE_ME__', 'disabled', 10)
ON CONFLICT (provider, label) DO NOTHING;
