# ALT-897 Azure PostgreSQL Schema Runbook

This runbook provisions the AutoFlow tenant schema on Azure PostgreSQL Flexible Server using raw SQL migrations.

## Prerequisites

- Reachable Azure PostgreSQL Flexible Server instance
- `psql` client installed on the executor host
- `DATABASE_URL` credential with permission to create extensions, tables, functions, policies, and triggers

## Required Environment

```bash
export DATABASE_URL="postgres://<user>:<password>@<host>:5432/<database>?sslmode=require"
export PGSSLMODE="require"
```

Optional split vars for connection composition:

```bash
export AZURE_POSTGRES_HOST="<server>.postgres.database.azure.com"
export AZURE_POSTGRES_PORT="5432"
export AZURE_POSTGRES_DB="autoflow"
export AZURE_POSTGRES_USER="<user>@<server>"
export AZURE_POSTGRES_PASSWORD="<password>"
```

## Apply migrations

```bash
# Canonical non-interactive command (captures proof logs)
DATABASE_URL="$DATABASE_URL" PGSSLMODE=require ./scripts/run-migrations.sh 2>&1 | tee /tmp/alt-897-migrations.log
```

Canonical migration artifact:

- `migrations/001_autoflow_schema.sql`

## Post-apply validation

Run these checks:

```sql
-- Confirm core tables exist.
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'workspaces',
    'workspace_members',
    'icp_profiles',
    'leads',
    'campaigns',
    'email_sends'
  )
ORDER BY tablename;

-- Confirm row-level security is enabled.
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN (
  'workspaces',
  'workspace_members',
  'icp_profiles',
  'leads',
  'campaigns',
  'email_sends'
)
ORDER BY relname;
```

## Proof markers for ALT-897

Capture and attach `/tmp/alt-897-migrations.log` to [ALT-897](/ALT/issues/ALT-897). Required markers:

- `Applying 001_autoflow_schema.sql`
- `All migrations applied successfully.`
- Zero `ERROR:` lines in the log

## Tenant isolation contract

Application connections must set both variables after auth resolution:

```sql
SET app.current_workspace_id = '<workspace-uuid>';
SET app.current_user_id = '<user-id>';
```

Without these values, RLS policies deny access by default.
