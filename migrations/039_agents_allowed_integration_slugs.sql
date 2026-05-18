-- Migration 039: agents.allowed_integration_slugs (DASH-23 / HEL-138)
--
-- Per-agent allowlist of integration slugs the agent may invoke as
-- tools. NULL means "inherit workspace defaults" (i.e. every
-- workspace_connector_connection is available); an explicit array
-- enforces a strict subset. Empty array means "no integrations,
-- text-only agent" — useful for the lite-tier triage / classifier
-- roles that don't need tool access.
--
-- Enforced at the provider tool-loop assembly site (see
-- `assembleAllowedAgentTools` in src/agents/agentToolPermissions.ts).
-- RLS is already on `agents`; the column is just a JSON array.
--
-- Hiring plan provisioner (src/missions/hiringPlanRoutes.ts) seeds
-- this from the staffing recommendation's `tools` field so the
-- agent inherits the LLM's draft. Owner can edit later via
-- /agents/:id/settings.

BEGIN;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS allowed_integration_slugs jsonb;

-- A GIN index supports the "which agents can use Slack?" reverse
-- lookup the dashboard's Integrations page will use.
CREATE INDEX IF NOT EXISTS idx_agents_allowed_integration_slugs
  ON agents USING gin (allowed_integration_slugs)
  WHERE allowed_integration_slugs IS NOT NULL;

COMMIT;
