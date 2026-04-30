/**
 * Workspace-bound execution guards (ALT-2057 / ALT-1915 Phase 4.2c).
 *
 * Two related security primitives:
 *
 *   1. assertAgentWorkspaceBinding - rejects an agent execution start when the
 *      caller-supplied workspace claim does not match the agent's actual
 *      team-level workspace. Without this guard, a misbehaving caller could
 *      pass a workspaceId that doesn't match the agent row and silently slip
 *      past tenant isolation in any code path that trusted the claim.
 *
 *   2. safeWorkspacePath - resolves an untrusted, agent-controlled path
 *      against a workspace-scoped sandbox root and rejects ".." traversal
 *      and absolute-path escapes. Today no agent code path writes to the
 *      filesystem, but the sandbox helper is the security bar any future FS
 *      tool/skill MUST go through. Establishing it now means a future commit
 *      that adds an FS tool can't quietly skip workspace scoping.
 */

import path from "path";

export interface AgentWorkspaceBinding {
  agentId: string;
  agentTeamId: string;
  teamId: string;
  teamWorkspaceId: string | undefined;
  claimedWorkspaceId: string | undefined;
}

/**
 * Refuses to start an agent execution unless the caller's workspace claim
 * matches the agent's team-level workspace binding. Throws synchronous
 * errors with stable message keys so route handlers and the worker boot
 * path can distinguish causes:
 *
 *   - agent_workspace_unbound: the team has no workspace_id (legacy data)
 *   - agent_workspace_mismatch: the caller passed a workspaceId that does
 *     not match the team's stored workspace
 *   - agent_team_mismatch: the agent's teamId does not match the team
 *     resolved by the caller (catches an upstream bug where a request
 *     pulled an agent from a sibling team)
 *
 * The guard is intentionally strict on `claimedWorkspaceId === undefined`
 * only when the team's workspace IS known: a missing claim plus a known
 * team workspace is treated as a workspace_unbound caller error so the
 * worker can't accidentally drop the workspace context. If both sides are
 * unknown, the guard accepts (no-PG / legacy mode), preserving backward
 * compatibility with controlPlaneStore's no-PG fallback.
 */
export function assertAgentWorkspaceBinding(binding: AgentWorkspaceBinding): void {
  if (binding.agentTeamId !== binding.teamId) {
    throw new Error("agent_team_mismatch");
  }

  const { teamWorkspaceId, claimedWorkspaceId } = binding;

  if (teamWorkspaceId && claimedWorkspaceId && teamWorkspaceId !== claimedWorkspaceId) {
    throw new Error("agent_workspace_mismatch");
  }

  if (teamWorkspaceId && !claimedWorkspaceId) {
    // Team is workspace-bound but caller passed no claim - refuse rather
    // than silently fall through. This catches a broken caller that
    // dropped the workspace plumbing.
    throw new Error("agent_workspace_claim_required");
  }
}

export interface SafeWorkspacePathInput {
  sandboxRoot: string;
  workspaceId: string;
  untrustedSubpath: string;
}

/**
 * Resolves an untrusted subpath against a workspace-scoped sandbox root and
 * rejects any path that escapes the workspace's directory. Throws on:
 *
 *   - empty/whitespace subpath
 *   - absolute subpath
 *   - subpath containing ".." segments before resolution
 *   - resolved path that lies outside the workspace's sandbox directory
 *   - missing or non-uuid-looking workspaceId (defensive)
 *
 * Returns the validated absolute path. Callers should treat the return
 * value as the only safe path to read/write; never reuse the original
 * untrusted string.
 *
 * The sandbox structure is:
 *
 *   <sandboxRoot>/<workspaceId>/<untrustedSubpath>
 *
 * Each workspace gets its own directory. workspaceId is part of the
 * boundary, so a subpath of "../<otherWorkspace>/foo" cannot reach a
 * sibling tenant - the ".." rejection blocks it before resolution.
 */
export function safeWorkspacePath(input: SafeWorkspacePathInput): string {
  const { sandboxRoot, workspaceId, untrustedSubpath } = input;

  if (typeof sandboxRoot !== "string" || !sandboxRoot.trim()) {
    throw new Error("sandbox_root_required");
  }
  if (typeof workspaceId !== "string" || !workspaceId.trim()) {
    throw new Error("workspace_id_required");
  }
  if (typeof untrustedSubpath !== "string" || !untrustedSubpath.trim()) {
    throw new Error("subpath_required");
  }

  if (path.isAbsolute(untrustedSubpath)) {
    throw new Error("subpath_must_be_relative");
  }

  // Reject ".." anywhere in the input. A caller cannot legitimately need
  // to walk up from a workspace-scoped subpath; if the resolved location
  // is "outside the workspace", that's exactly what the sandbox forbids.
  const segments = untrustedSubpath.split(/[\\/]+/);
  if (segments.some((segment) => segment === "..")) {
    throw new Error("subpath_contains_traversal");
  }

  const workspaceRoot = path.resolve(sandboxRoot, workspaceId);
  const resolved = path.resolve(workspaceRoot, untrustedSubpath);

  // Defence in depth: even if the ".." check above missed an exotic
  // encoding, verify the resolved path stays inside the workspace root.
  // Append path.sep so /tmp/sandbox/wsA-evil cannot match /tmp/sandbox/wsA.
  const workspaceRootWithSep = workspaceRoot.endsWith(path.sep)
    ? workspaceRoot
    : `${workspaceRoot}${path.sep}`;
  if (resolved !== workspaceRoot && !resolved.startsWith(workspaceRootWithSep)) {
    throw new Error("subpath_escapes_sandbox");
  }

  return resolved;
}
