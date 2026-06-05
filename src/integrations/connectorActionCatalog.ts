import type { Pool } from "pg";
import { withUserContext } from "../middleware/workspaceContext";
import { listConnectorActions } from "../engine/connectorActions";

/**
 * HEL-657 (HEL-647 PR 4): connection-gated action catalog for the Workflow
 * Studio builder.
 *
 * Returns every registered connector action annotated with whether the given
 * user has the backing connector connected (run-owner scope). The builder
 * uses `connected` to surface "suggestions" — and a newly-built + connected
 * connector's actions light up here with no builder change.
 */
export interface ConnectorActionCatalogEntry {
  connectorKey: string;
  actionId: string;
  label: string;
  description?: string;
  isWrite: boolean;
  connected: boolean;
}

export async function buildConnectorActionCatalog(
  pool: Pool | null,
  userId: string,
): Promise<ConnectorActionCatalogEntry[]> {
  // Which connectors has THIS user connected? One RLS-scoped query over the
  // user-scoped credential table — no connector-service imports, no tokens.
  // `connector_credentials.service` (e.g. "slack") matches the registry's
  // connectorKey / connectionProvider.
  let connected = new Set<string>();
  if (pool) {
    try {
      const rows = await withUserContext(pool, userId, async (client) => {
        const result = await client.query<{ service: string }>(
          `SELECT DISTINCT service
             FROM connector_credentials
            WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        );
        return result.rows;
      });
      connected = new Set(rows.map((r) => r.service));
    } catch (err) {
      // Degrade gracefully — report the catalog with nothing connected rather
      // than failing the builder's palette load.
      console.error(
        `[connectors/actions] connection lookup failed: ${(err as Error).message}`,
      );
    }
  }

  return listConnectorActions().map((a) => {
    const entry: ConnectorActionCatalogEntry = {
      connectorKey: a.connectorKey,
      actionId: a.actionId,
      label: a.label,
      isWrite: a.isWrite,
      connected: connected.has(a.connectionProvider ?? a.connectorKey),
    };
    if (a.description) entry.description = a.description;
    return entry;
  });
}
