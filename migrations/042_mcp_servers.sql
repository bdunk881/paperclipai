-- DASH-50: persist user-registered MCP server connections.
--
-- Pre-DASH-50 src/mcp/mcpStore.ts was a single in-memory Map<id, McpServer>.
-- Every Fly restart wiped the user's registered MCP servers. The dashboard's
-- /settings/mcp-servers page showed nothing until the user re-added each
-- connection by hand.
--
-- auth_header_value is plaintext — matches the in-memory shape. Future work
-- should move this onto the connectorSecretVault encryption envelope used by
-- llm_credentials etc.; deferred to keep the migration mechanical.

CREATE TABLE IF NOT EXISTS mcp_servers (
  id                   uuid PRIMARY KEY,
  user_id              text NOT NULL,
  name                 text NOT NULL,
  url                  text NOT NULL,
  auth_header_key      text,
  auth_header_value    text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_user
  ON mcp_servers (user_id, created_at ASC);
