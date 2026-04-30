/**
 * Agent worker-boot guard (ALT-2057, Phase 4.2c).
 *
 * Callers that start an execution must supply the same workspace binding that
 * the target team already carries. A mismatched team or workspace claim is a
 * hard failure, which prevents cross-tenant execution boot.
 */
export interface AgentWorkspaceBindingInput {
  agentId: string;
  agentTeamId: string;
  resolvedTeamId: string;
  teamWorkspaceId: string | undefined;
  claimedWorkspaceId: string | undefined;
}

export class AgentWorkspaceBindingError extends Error {
  constructor(message: string, readonly code: AgentWorkspaceBindingErrorCode) {
    super(message);
    this.name = "AgentWorkspaceBindingError";
  }
}

export type AgentWorkspaceBindingErrorCode =
  | "agent_team_mismatch"
  | "agent_workspace_mismatch";

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
