BEGIN;

ALTER TABLE connector_credentials
  ADD COLUMN IF NOT EXISTS key_version integer NOT NULL DEFAULT 1 CHECK (key_version >= 1);

CREATE INDEX IF NOT EXISTS idx_connector_credentials_key_version
  ON connector_credentials (key_version);

DO $$
BEGIN
  IF to_regclass('public.llm_credentials') IS NOT NULL THEN
    ALTER TABLE public.llm_credentials
      ADD COLUMN IF NOT EXISTS key_version integer NOT NULL DEFAULT 1 CHECK (key_version >= 1);

    CREATE INDEX IF NOT EXISTS idx_llm_credentials_key_version
      ON public.llm_credentials (key_version);
  END IF;
END $$;

COMMIT;
