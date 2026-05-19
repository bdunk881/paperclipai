-- DASH-52: drop the seven orphan tables flagged by Claude+Codex audits.
--
-- Each table is confirmed zero-ref across src/ (non-test):
--   $ grep -rE 'FROM <tbl>|INTO <tbl>|UPDATE <tbl>' src --include='*.ts' | grep -v test
--
-- Rationale per table:
--
--   agent_assignments (031_agent_assignments_org_edges.sql)
--     Latent canonical table — was authored alongside org_edges but no code
--     path ever populated it. Hiring-plan confirm writes directly to `agents`
--     and `org_edges`. If we want assignment tracking later we'll re-add a
--     migration with the actual use case in mind.
--
--   agent_memory_sharing_policies, agent_memory_workspace_shares
--     (016_agent_memory_workspace_isolation.sql) — replaced by the
--     three-layer memory model (HEL-86, migration 034: workspace_instructions
--     + knowledge_items + agent_episodes). Active path uses
--     agentMemoryStore.ts against the workspace-scoped tables, not these.
--
--   icp_profiles, email_sends, campaigns (001_autoflow_schema.sql)
--     Pre-canonical outreach prototype. Replaced by the connector/integration
--     framework + workflow runtime. No application code references them.
--
--   llm_configs (005_llm_configs.sql)
--     Storage for LLM provider credentials moved to CentralCredentialStore
--     (via the shared `connector_credentials` table, migration 006). Confirmed
--     by Codex's audit (HEL-140 M4): llmConfigStore.ts uses
--     credentialRegistry with service "llm-config".
--
-- Git history preserves the schema if we ever need to recreate.

DROP TABLE IF EXISTS agent_assignments CASCADE;
DROP TABLE IF EXISTS agent_memory_sharing_policies CASCADE;
DROP TABLE IF EXISTS agent_memory_workspace_shares CASCADE;
DROP TABLE IF EXISTS icp_profiles CASCADE;
DROP TABLE IF EXISTS email_sends CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;
DROP TABLE IF EXISTS llm_configs CASCADE;
