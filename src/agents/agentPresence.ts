/**
 * Live agent presence layer (Wave 2a).
 *
 * The dashboard's existing agent status (controlPlaneStore +
 * lastHeartbeatStatus) reflects the *last* run that touched an agent
 * — useful for history, useless for "is Aaron alive right now?"
 *
 * This module adds a Redis-backed, TTL'd live-presence channel layered
 * on top of the existing status surface:
 *
 *   - `setAgentPresence(workspaceId, agentId, state)` writes
 *     `SETEX agent:<workspace>:<agent>:presence <TTL> <json>` and
 *     publishes the change to `workspace:<workspace>:agent-presence`
 *     so subscribers (Wave 2b SSE stream) can fan it out without
 *     polling.
 *   - `getAgentPresence(workspaceId, agentId)` reads the key, returns
 *     null when the TTL has lapsed (agent considered offline).
 *   - `listWorkspaceAgentPresence(workspaceId)` SCAN-s by prefix and
 *     returns every live agent's current state.
 *
 * Producer (Wave 2c): the engine's `handleAgent` step handler calls
 * setAgentPresence on start/complete so the data is real instead of
 * dead-channel.
 *
 * When Redis isn't configured (tests, local dev without REDIS_URL),
 * every helper is a safe no-op / empty-result — callers never have
 * to null-check the client themselves.
 */

import { getRedisClient } from "../queue/redisClient";

/** Per-key TTL. Producer is expected to re-ping inside this window. */
export const AGENT_PRESENCE_TTL_SECONDS = 30;

/** Channel for workspace-scoped presence-change pub/sub. */
export function presenceChannel(workspaceId: string): string {
  return `workspace:${workspaceId}:agent-presence`;
}

export function presenceKey(workspaceId: string, agentId: string): string {
  return `agent:${workspaceId}:${agentId}:presence`;
}

export type AgentPresenceState =
  | "working"
  | "idle"
  | "blocked"
  | "checking-in";

export interface AgentPresence {
  agentId: string;
  workspaceId: string;
  state: AgentPresenceState;
  /** Free-text "what they're doing right now", e.g. "processing invoice #42". */
  currentTask: string | null;
  /** When the current state started (preserved across pings of the same state). */
  since: string;
  /** Wall-clock of the most recent ping; the TTL keys off this. */
  updatedAt: string;
}

interface SetPresenceInput {
  workspaceId: string;
  agentId: string;
  state: AgentPresenceState;
  currentTask?: string | null;
}

/**
 * Writes (or refreshes) the agent's presence + publishes a change
 * event for SSE subscribers. Returns the persisted shape so callers
 * can return it from a route handler in one go.
 *
 * No-op when Redis isn't configured — returns the shape the caller
 * would have stored, so logical flow stays the same.
 */
export async function setAgentPresence(
  input: SetPresenceInput,
): Promise<AgentPresence> {
  const now = new Date().toISOString();
  const redis = getRedisClient();

  // Preserve `since` across same-state pings: only reset it when the
  // state actually transitions. Falling back to `now` when the prior
  // value is missing keeps the contract intact for first-ping callers.
  let since = now;
  if (redis) {
    try {
      const prior = await redis.get(presenceKey(input.workspaceId, input.agentId));
      if (prior) {
        const parsed = JSON.parse(prior) as Partial<AgentPresence>;
        if (parsed.state === input.state && typeof parsed.since === "string") {
          since = parsed.since;
        }
      }
    } catch {
      // Read failure → treat as no prior state; the SETEX below still
      // produces a valid record. Surfacing the read error here would
      // make the presence layer hide its own producers.
    }
  }

  const value: AgentPresence = {
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    state: input.state,
    currentTask: input.currentTask?.trim() || null,
    since,
    updatedAt: now,
  };

  if (redis) {
    const payload = JSON.stringify(value);
    try {
      await redis.set(
        presenceKey(input.workspaceId, input.agentId),
        payload,
        "EX",
        AGENT_PRESENCE_TTL_SECONDS,
      );
      // Best-effort publish; subscribers wake on the channel and
      // re-read the key for the canonical state.
      await redis.publish(presenceChannel(input.workspaceId), payload);
    } catch (err) {
      // Swallow publish/set failures — presence is a hint, not a
      // source of truth. The next ping will overwrite stale state.
      console.warn(
        `[agentPresence] write failed for ${input.agentId}: ${(err as Error).message}`,
      );
    }
  }

  return value;
}

/**
 * Single-agent lookup. Returns null when the key has expired or Redis
 * isn't configured.
 */
export async function getAgentPresence(
  workspaceId: string,
  agentId: string,
): Promise<AgentPresence | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(presenceKey(workspaceId, agentId));
    return raw ? (JSON.parse(raw) as AgentPresence) : null;
  } catch (err) {
    console.warn(
      `[agentPresence] read failed for ${agentId}: ${(err as Error).message}`,
    );
    return null;
  }
}

/**
 * SCAN-s every presence key in the workspace and returns the current
 * state of each live agent. Agents whose TTL has lapsed simply don't
 * appear in the result — that's the offline signal.
 *
 * Uses MATCH+COUNT pagination so a workspace with many agents doesn't
 * lock Redis on a KEYS call. The inner mget batches reads.
 */
export async function listWorkspaceAgentPresence(
  workspaceId: string,
): Promise<AgentPresence[]> {
  const redis = getRedisClient();
  if (!redis) return [];
  const pattern = `agent:${workspaceId}:*:presence`;
  const keys: string[] = [];
  try {
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        200,
      );
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0");
  } catch (err) {
    console.warn(
      `[agentPresence] scan failed for workspace ${workspaceId}: ${(err as Error).message}`,
    );
    return [];
  }

  if (keys.length === 0) return [];
  try {
    const values = await redis.mget(...keys);
    const out: AgentPresence[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        out.push(JSON.parse(raw) as AgentPresence);
      } catch {
        // Skip malformed entries rather than fail the whole list.
      }
    }
    return out;
  } catch (err) {
    console.warn(
      `[agentPresence] mget failed for workspace ${workspaceId}: ${(err as Error).message}`,
    );
    return [];
  }
}
