BEGIN;

CREATE TABLE IF NOT EXISTS connector_credentials (
  service text NOT NULL,
  id text NOT NULL,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  record_data jsonb NOT NULL,
  PRIMARY KEY (service, id)
);

CREATE INDEX IF NOT EXISTS idx_connector_credentials_service_user
  ON connector_credentials (service, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connector_credentials_service_revoked
  ON connector_credentials (service, revoked_at);

COMMIT;
