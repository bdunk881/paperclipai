/**
 * Agent worker-boot guard (ALT-2057, Phase 4.2c — closes AC5 + AC6).
 *
 * When an agent execution starts, the caller passes a `workspaceId` claim
 * (resolved from the workflow step / request context). The actual agent row
 * is bound to a team, and the team is bound to a workspace via
 * `teamWorkspaceIds` in controlPlaneStore. Without this guard, a misbehaving
 * caller could pass a workspaceId that doesn't match the agent's actual
 * workspace - any code path downstream that trusted the claim would silently
 * cross tenant boundaries.
 *
 * The guard is intentionally synchronous (pure check, no I/O) so it can be
 * invoked from any code path - the worker entrypoint (handleAgent in
 * src/engine/stepHandlers.ts), control-plane routes that start executions,
 * or test fixtures that simulate boot.
 */

export interface AgentWorkspaceBindingInput {
  /** The agent record's id, for error context only. */
  agentId: string;
  /** The agent record's teamId. */
  agentTeamId: string;
  /** The team the caller resolved from the request. Must match agentTeamId. */
  resolvedTeamId: string;
  /** The team's stored workspace_id (from teamWorkspaceIds.get(teamId)). */
  teamWorkspaceId: string | undefined;
  /** The workspaceId the caller passed in. */
  claimedWorkspaceId: string | undefined;
}

export class AgentWorkspaceBindingError extends Error {
  constructor(message: string, readonly code: AgentWorkspaceBindingErrorCode) {
    super(message);
    this.name = "AgentWorkspaceBindingError";
  }
}

export type AgentWorkspaceBindingErrorCode =
  /** The agent's teamId does not match the team resolved by the caller. */
  | "agent_team_mismatch"
  /** Caller's workspace claim does not match the team's stored workspace. */
  | "agent_workspace_mismatch";

/**
 * Refuses to start an agent execution unless the workspace claim is sound:
 *
 *   - agentTeamId must equal the resolvedTeamId (catches agent-from-sibling-team)
 *   - if both teamWorkspaceId and claimedWorkspaceId are known, they must match
 *
 * If claimedWorkspaceId is missing, accept and trust the team's stored
 * binding — mirrors the tolerance of matchesWorkspace() in controlPlaneStore
 * and lets pre-Phase-2 callers (and tests that haven't been plumbed through
 * the workspace context yet) keep working without weakening the mismatch
 * guard for callers that DO assert a claim.
 *
 * Throws AgentWorkspaceBindingError on rejection. Returns nothing on accept.
 */
export function assertAgentWorkspaceBinding(input: AgentWorkspaceBindingInput): void {
  if (input.agentTeamId !== input.resolvedTeamId) {
    throw new AgentWorkspaceBindingError(
      `Agent ${input.agentId} belongs to team ${input.agentTeamId}, not ${input.resolvedTeamId}`,
      "agent_team_mismatch",
    );
  }

  const { teamWorkspaceId, claimedWorkspaceId } = input;

  if (teamWorkspaceId && claimedWorkspaceId && teamWorkspaceId !== claimedWorkspaceId) {
    throw new AgentWorkspaceBindingError(
      `Agent ${input.agentId} workspace claim ${claimedWorkspaceId} does not match team workspace ${teamWorkspaceId}`,
      "agent_workspace_mismatch",
    );
  }
}
