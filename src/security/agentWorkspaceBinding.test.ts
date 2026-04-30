import {
  AgentWorkspaceBindingError,
  assertAgentWorkspaceBinding,
} from "./agentWorkspaceBinding";

describe("assertAgentWorkspaceBinding", () => {
  const baseInput = {
    agentId: "agent-1",
    agentTeamId: "team-1",
    resolvedTeamId: "team-1",
    teamWorkspaceId: "ws-A",
    claimedWorkspaceId: "ws-A",
  };

  it("accepts a sound workspace claim", () => {
    expect(() => assertAgentWorkspaceBinding(baseInput)).not.toThrow();
  });

  it("rejects when the agent's teamId does not match the resolved team", () => {
    try {
      assertAgentWorkspaceBinding({ ...baseInput, agentTeamId: "team-other" });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentWorkspaceBindingError);
      expect((err as AgentWorkspaceBindingError).code).toBe("agent_team_mismatch");
    }
  });

  it("rejects when caller claims a different workspace than the team's binding", () => {
    try {
      assertAgentWorkspaceBinding({ ...baseInput, claimedWorkspaceId: "ws-B" });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentWorkspaceBindingError);
      expect((err as AgentWorkspaceBindingError).code).toBe("agent_workspace_mismatch");
    }
  });

  it("rejects when team is workspace-bound but caller passed no claim", () => {
    try {
      assertAgentWorkspaceBinding({ ...baseInput, claimedWorkspaceId: undefined });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentWorkspaceBindingError);
      expect((err as AgentWorkspaceBindingError).code).toBe("agent_workspace_claim_required");
    }
  });

  it("accepts when both team and caller workspaces are unknown (no-PG / legacy mode)", () => {
    expect(() =>
      assertAgentWorkspaceBinding({
        ...baseInput,
        teamWorkspaceId: undefined,
        claimedWorkspaceId: undefined,
      })
    ).not.toThrow();
  });

  it("accepts when team workspace is unknown but caller passed a claim (pre-hydration)", () => {
    expect(() =>
      assertAgentWorkspaceBinding({
        ...baseInput,
        teamWorkspaceId: undefined,
        claimedWorkspaceId: "ws-A",
      })
    ).not.toThrow();
  });

  it("rejection messages mention the agent id for forensic linkage", () => {
    try {
      assertAgentWorkspaceBinding({ ...baseInput, claimedWorkspaceId: "ws-B" });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as Error).message).toContain("agent-1");
    }
  });
});
