import path from "path";
import {
  assertAgentWorkspaceBinding,
  safeWorkspacePath,
} from "./workspaceSandbox";

describe("assertAgentWorkspaceBinding", () => {
  const baseBinding = {
    agentId: "agent-1",
    agentTeamId: "team-1",
    teamId: "team-1",
    teamWorkspaceId: "ws-1",
    claimedWorkspaceId: "ws-1",
  } as const;

  it("accepts when team workspace matches the caller's claim", () => {
    expect(() => assertAgentWorkspaceBinding({ ...baseBinding })).not.toThrow();
  });

  it("accepts in legacy mode when both team workspace and claim are unknown", () => {
    expect(() =>
      assertAgentWorkspaceBinding({
        ...baseBinding,
        teamWorkspaceId: undefined,
        claimedWorkspaceId: undefined,
      }),
    ).not.toThrow();
  });

  it("throws agent_team_mismatch when the agent's team does not match the resolved team", () => {
    expect(() =>
      assertAgentWorkspaceBinding({
        ...baseBinding,
        agentTeamId: "team-2",
      }),
    ).toThrow("agent_team_mismatch");
  });

  it("throws agent_workspace_mismatch when the caller's claim differs from the team's workspace", () => {
    expect(() =>
      assertAgentWorkspaceBinding({
        ...baseBinding,
        claimedWorkspaceId: "ws-attacker",
      }),
    ).toThrow("agent_workspace_mismatch");
  });

  it("throws agent_workspace_claim_required when team is workspace-bound but the caller passed no claim", () => {
    expect(() =>
      assertAgentWorkspaceBinding({
        ...baseBinding,
        claimedWorkspaceId: undefined,
      }),
    ).toThrow("agent_workspace_claim_required");
  });

  it("accepts when the team has no workspace and the caller passed a claim (legacy team, new caller)", () => {
    expect(() =>
      assertAgentWorkspaceBinding({
        ...baseBinding,
        teamWorkspaceId: undefined,
        claimedWorkspaceId: "ws-anything",
      }),
    ).not.toThrow();
  });
});

describe("safeWorkspacePath", () => {
  const sandboxRoot = "/tmp/sandbox";
  const workspaceId = "ws-1";

  it("returns the resolved path for a safe relative subpath", () => {
    const resolved = safeWorkspacePath({
      sandboxRoot,
      workspaceId,
      untrustedSubpath: "outputs/report.txt",
    });
    expect(resolved).toBe(
      path.resolve(sandboxRoot, workspaceId, "outputs/report.txt"),
    );
  });

  it("rejects an empty subpath", () => {
    expect(() =>
      safeWorkspacePath({ sandboxRoot, workspaceId, untrustedSubpath: "" }),
    ).toThrow("subpath_required");
  });

  it("rejects a whitespace-only subpath", () => {
    expect(() =>
      safeWorkspacePath({
        sandboxRoot,
        workspaceId,
        untrustedSubpath: "   ",
      }),
    ).toThrow("subpath_required");
  });

  it("rejects an empty sandbox root", () => {
    expect(() =>
      safeWorkspacePath({
        sandboxRoot: "",
        workspaceId,
        untrustedSubpath: "x",
      }),
    ).toThrow("sandbox_root_required");
  });

  it("rejects an empty workspace id", () => {
    expect(() =>
      safeWorkspacePath({
        sandboxRoot,
        workspaceId: "",
        untrustedSubpath: "x",
      }),
    ).toThrow("workspace_id_required");
  });

  it("rejects an absolute subpath", () => {
    expect(() =>
      safeWorkspacePath({
        sandboxRoot,
        workspaceId,
        untrustedSubpath: "/etc/passwd",
      }),
    ).toThrow("subpath_must_be_relative");
  });

  it("rejects ../etc/passwd before any FS access (ALT-2057 AC)", () => {
    expect(() =>
      safeWorkspacePath({
        sandboxRoot,
        workspaceId,
        untrustedSubpath: "../etc/passwd",
      }),
    ).toThrow("subpath_contains_traversal");
  });

  it("rejects any embedded .. segment", () => {
    expect(() =>
      safeWorkspacePath({
        sandboxRoot,
        workspaceId,
        untrustedSubpath: "outputs/../../escape.txt",
      }),
    ).toThrow("subpath_contains_traversal");
  });

  it("rejects backslash-separated traversal on POSIX hosts", () => {
    expect(() =>
      safeWorkspacePath({
        sandboxRoot,
        workspaceId,
        untrustedSubpath: "outputs\\..\\escape.txt",
      }),
    ).toThrow("subpath_contains_traversal");
  });

  it("scopes the resolved path to the per-workspace directory", () => {
    const resolved = safeWorkspacePath({
      sandboxRoot,
      workspaceId,
      untrustedSubpath: "logs/run.log",
    });
    expect(resolved.startsWith(path.resolve(sandboxRoot, workspaceId) + path.sep)).toBe(
      true,
    );
  });

  it("rejects a sibling-workspace prefix attack (ws-1-evil vs ws-1)", () => {
    expect(() =>
      safeWorkspacePath({
        sandboxRoot,
        workspaceId: "ws-1",
        untrustedSubpath: "../ws-1-evil/secret.txt",
      }),
    ).toThrow("subpath_contains_traversal");
  });

  it("derives the sandbox path from workspaceId, not a global env var", () => {
    const a = safeWorkspacePath({
      sandboxRoot,
      workspaceId: "ws-A",
      untrustedSubpath: "x.txt",
    });
    const b = safeWorkspacePath({
      sandboxRoot,
      workspaceId: "ws-B",
      untrustedSubpath: "x.txt",
    });
    expect(a).not.toBe(b);
    expect(a.startsWith(path.resolve(sandboxRoot, "ws-A"))).toBe(true);
    expect(b.startsWith(path.resolve(sandboxRoot, "ws-B"))).toBe(true);
  });
});
