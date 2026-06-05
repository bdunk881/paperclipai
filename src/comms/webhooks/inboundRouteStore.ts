/**
 * Inbound-route store (HEL-613).
 *
 * Resolves an inbound address/number → its owning workspace/agent, and the
 * workspace's owner user (a member) so a sessionless webhook can publish under
 * the membership-gated wake_events RLS. Postgres path goes through the
 * SECURITY DEFINER resolvers in migration 103 (the webhook has no workspace
 * context). Hybrid in-memory mirror for dev/test, mirroring commsSendStore.
 */

import {
  getPostgresPool,
  inMemoryAllowed,
  isPostgresConfigured,
  queryPostgres,
} from "../../db/postgres";
import { withWorkspaceContext } from "../../middleware/workspaceContext";
import { COMMS_SYSTEM_ACTOR_USER_ID } from "../commsSendStore";
import type { CommsChannel } from "../types";

export interface InboundRoute {
  workspaceId: string;
  agentId: string | null;
}

export interface UpsertInboundRouteInput {
  workspaceId: string;
  agentId?: string | null;
  channel: CommsChannel;
  address: string;
  /** Acting user for the RLS context on write. Defaults to the system actor. */
  userId?: string;
}

// allowlist: hybrid store; in-memory mirror of Postgres comms_inbound_routes
const memRoutes = new Map<string, InboundRoute>();

function key(channel: CommsChannel, address: string): string {
  return `${channel}:${address}`;
}

function postgresPersistenceAvailable(): boolean {
  if (isPostgresConfigured()) {
    return true;
  }
  if (inMemoryAllowed()) {
    return false;
  }
  throw new Error("inboundRouteStore requires DATABASE_URL outside development/test.");
}

export const inboundRouteStore = {
  /** Resolve an inbound address to its owning workspace/agent (pre-tenancy). */
  async resolve(channel: CommsChannel, address: string): Promise<InboundRoute | null> {
    if (!postgresPersistenceAvailable()) {
      const route = memRoutes.get(key(channel, address));
      return route ? { ...route } : null;
    }
    const result = await getPostgresPool().query<{
      workspace_id: string;
      agent_id: string | null;
    }>(`SELECT workspace_id, agent_id FROM comms_resolve_inbound_route($1, $2)`, [
      channel,
      address,
    ]);
    const row = result.rows[0];
    return row ? { workspaceId: row.workspace_id, agentId: row.agent_id } : null;
  },

  /**
   * Resolve a workspace's owner user id (a guaranteed member), used as the RLS
   * actor when publishing a wake event for a sessionless webhook.
   */
  async resolveWorkspaceOwnerUserId(workspaceId: string): Promise<string | null> {
    if (!postgresPersistenceAvailable()) {
      return null;
    }
    const result = await getPostgresPool().query<{ owner: string | null }>(
      `SELECT comms_resolve_workspace_owner($1) AS owner`,
      [workspaceId],
    );
    return result.rows[0]?.owner ?? null;
  },

  /**
   * Upsert an inbound route. HEL-616 (per-agent number provisioning) is the
   * main writer; HEL-613 uses it for fixtures + admin seeding.
   */
  async upsert(input: UpsertInboundRouteInput): Promise<void> {
    if (!postgresPersistenceAvailable()) {
      memRoutes.set(key(input.channel, input.address), {
        workspaceId: input.workspaceId,
        agentId: input.agentId ?? null,
      });
      return;
    }
    await withWorkspaceContext(
      getPostgresPool(),
      { workspaceId: input.workspaceId, userId: input.userId ?? COMMS_SYSTEM_ACTOR_USER_ID },
      (client) =>
        client.query(
          `INSERT INTO comms_inbound_routes (workspace_id, agent_id, channel, address)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (channel, address)
           DO UPDATE SET workspace_id = EXCLUDED.workspace_id,
                         agent_id = EXCLUDED.agent_id,
                         updated_at = now()`,
          [input.workspaceId, input.agentId ?? null, input.channel, input.address],
        ),
    );
  },

  /** Test/dev only: wipe routes. */
  async clear(): Promise<void> {
    memRoutes.clear();
    if (postgresPersistenceAvailable()) {
      await queryPostgres("DELETE FROM comms_inbound_routes");
    }
  },
};
