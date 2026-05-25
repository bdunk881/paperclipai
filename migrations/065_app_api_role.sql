-- HEL-196 — Application API role for RLS enforcement.
--
-- The CI (and local-dev Docker) environment creates `POSTGRES_USER=autoflow`
-- as a superuser. PostgreSQL superusers bypass ALL row-level security,
-- including tables with FORCE ROW LEVEL SECURITY — so the RLS integration
-- tests were seeing both workspaces' rows when they expected to see only
-- one. This migration creates `autoflow_api`, a non-superuser role with
-- NOBYPASSRLS, that the integration tests SET LOCAL ROLE into inside
-- transactions to exercise real policy enforcement.
--
-- In production the app should connect using autoflow_api (or a similarly
-- scoped role) rather than the superuser. The migration is safe to run on
-- an already-bootstrapped DB: CREATE ROLE is idempotent via DO block,
-- and GRANT is idempotent by design (re-granting an already-held privilege
-- is a no-op in PostgreSQL).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autoflow_api') THEN
    CREATE ROLE autoflow_api
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOBYPASSRLS
      NOINHERIT
      NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO autoflow_api;

-- Grant access to all tables, sequences, and functions that currently exist.
GRANT ALL PRIVILEGES ON ALL TABLES     IN SCHEMA public TO autoflow_api;
GRANT ALL PRIVILEGES ON ALL SEQUENCES  IN SCHEMA public TO autoflow_api;
GRANT EXECUTE        ON ALL FUNCTIONS  IN SCHEMA public TO autoflow_api;

-- Allow the superuser pool connection (autoflow) to SET ROLE autoflow_api.
-- This is a no-op if autoflow is a superuser (superusers can always SET ROLE
-- to any role), but makes the intent explicit and supports the case where
-- the pool user is downgraded to a non-superuser in the future.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autoflow') THEN
    EXECUTE 'GRANT autoflow_api TO autoflow';
  END IF;
END $$;

-- Ensure tables/sequences/functions created by autoflow in future migrations
-- are automatically accessible to autoflow_api.
ALTER DEFAULT PRIVILEGES FOR ROLE autoflow IN SCHEMA public
  GRANT ALL ON TABLES    TO autoflow_api;
ALTER DEFAULT PRIVILEGES FOR ROLE autoflow IN SCHEMA public
  GRANT ALL ON SEQUENCES TO autoflow_api;
ALTER DEFAULT PRIVILEGES FOR ROLE autoflow IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO autoflow_api;
