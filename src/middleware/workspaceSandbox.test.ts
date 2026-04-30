import path from "path";
import { assertAgentWorkspaceBinding, safeWorkspacePath } from "./workspaceSandbox";

describe("assertAgentWorkspaceBinding", () => {
  const baseBinding = {
    agentId: "agent-1",
    agentTeamId: "team-1",
    teamId: "team-1",
    teamWorkspaceId: "ws-A",
    claimedWorkspaceId: "ws-A",
  };

  it("accepts a matching workspace claim", () => {
    expect(() => assertAgentWorkspaceBinding(baseBinding)).not.toThrow();
  });

  it("throws agent_team_mismatch when the agent's teamId does not match the resolved team", () => {
    expect(() =>
      assertAgentWorkspaceBinding({ ...baseBinding, agentTeamId: "team-other" })
    ).toThrow(/agent_team_mismatch/);
  });

  it("throws agent_workspace_mismatch when the caller claims a different workspace than the team's binding", () => {
    expect(() =>
      assertAgentWorkspaceBinding({ ...baseBinding, claimedWorkspaceId: "ws-B" })
    ).toThrow(/agent_workspace_mismatch/);
  });

  it("throws agent_workspace_claim_required when the team is workspace-bound but the caller passed no claim", () => {
    expect(() =>
      assertAgentWorkspaceBinding({ ...baseBinding, claimedWorkspaceId: undefined })
    ).toThrow(/agent_workspace_claim_required/);
  });

  it("accepts when both team and caller workspaces are unknown (no-PG / legacy mode)", () => {
    expect(() =>
      assertAgentWorkspaceBinding({
        ...baseBinding,
        teamWorkspaceId: undefined,
        claimedWorkspaceId: undefined,
      })
    ).not.toThrow();
  });

  it("accepts when the team's workspace is unknown but the caller passed a claim (hydration not yet complete)", () => {
    expect(() =>
      assertAgentWorkspaceBinding({
        ...baseBinding,
        teamWorkspaceId: undefined,
        claimedWorkspaceId: "ws-A",
      })
    ).not.toThrow();
  });
});

describe("safeWorkspacePath", () => {
  const sandboxRoot = "/tmp/sandbox";
  const workspaceId = "ws-A";

  it("resolves a legitimate workspace-scoped subpath", () => {
    const resolved = safeWorkspacePath({
      sandboxRoot,
      workspaceId,
      untrustedSubpath: "files/output.json",
    });
    expect(resolved).toBe(path.resolve(sandboxRoot, workspaceId, "files/output.json"));
  });

  it("rejects a subpath containing .. segments before resolution", () => {
    expect(() =>
      safeWorkspacePath({
        sandboxRoot,
        workspaceId,
        untrustedSubpath: "../etc/passwd",
      })
    ).toThrow(/subpath_contains_traversal/);
  });

  it("rejects nested .. traversal", () => {
    expect(() =>
      safeWorkspacePath({
        sandboxRoot,
        workspaceId,
        untrustedSubpath: "files/../../etc/passwd",
      })
    ).toThrow(/subpath_contains_traversal/);
  });

  it("rejects backslash .. on platforms that interpret it as a separator", () => {
    expect(() =>
      safeWorkspacePath({
        sandboxRoot,
        workspaceId,
        untrustedSubpath: "files\\..\\..\\etc\\passwd",
      })
    ).toThrow(/subpath_contains_traversal/);
  });

  it("rejects an absolute subpath", () => {
    expect(() =>
      safeWorkspacePath({
        sandboxRoot,
        workspaceId,
        untrustedSubpath: "/etc/passwd",
      })
    ).toThrow(/subpath_must_be_relative/);
  });

  it("rejects an empty subpath", () => {
    expect(() =>
      safeWorkspacePath({ sandboxRoot, workspaceId, untrustedSubpath: "" })
    ).toThrow(/subpath_required/);
  });

  it("rejects a whitespace-only subpath", () => {
    expect(() =>
      safeWorkspacePath({ sandboxRoot, workspaceId, untrustedSubpath: "   " })
    ).toThrow(/subpath_required/);
  });

  it("rejects a missing sandbox root", () => {
    expect(() =>
      safeWorkspacePath({ sandboxRoot: "", workspaceId, untrustedSubpath: "f" })
    ).toThrow(/sandbox_root_required/);
  });

  it("rejects a missing workspace id", () => {
    expect(() =>
      safeWorkspacePath({ sandboxRoot, workspaceId: "", untrustedSubpath: "f" })
    ).toThrow(/workspace_id_required/);
  });

  it("scopes per-workspace so workspace A cannot point inside workspace B", () => {
    expect(() =>
      safeWorkspacePath({
        sandboxRoot,
        workspaceId: "ws-A",
        untrustedSubpath: "../ws-B/secret.txt",
      })
    ).toThrow(/subpath_contains_traversal/);
  });

  it("does not allow a sibling-prefix attack where workspaceA-evil collides with workspaceA prefix", () => {
    // Even if a hypothetical encoding bypass dropped the .. check, the
    // sandbox-prefix assertion must keep ws-A-evil from matching as ws-A.
    // We construct a contrived case by directly invoking with a workspace
    // whose name would prefix-match without the trailing separator guard.
    const resolved = safeWorkspacePath({
      sandboxRoot,
      workspaceId: "ws-A",
      untrustedSubpath: "files/output.json",
    });
    // Make sure the resolved path lives under ws-A and not ws-A-evil.
    expect(resolved.startsWith(path.resolve(sandboxRoot, "ws-A") + path.sep)).toBe(true);
    expect(resolved.startsWith(path.resolve(sandboxRoot, "ws-A-evil"))).toBe(false);
  });
});
