import { controlPlaneStore, resetControlPlaneStoreForTests } from "./controlPlaneStore";

describe("controlPlaneStore identity scoping", () => {
  beforeEach(() => {
    resetControlPlaneStoreForTests();
  });

  afterEach(() => {
    resetControlPlaneStoreForTests();
  });

  it("exposes company workspace data to a second identity in the same workspace", async () => {
    const provisioningUserId = "agent-user";
    const browserUserId = "ceo-browser-user";
    const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    const provisioned = await controlPlaneStore.provisionCompanyWorkspace({
      workspaceId,
      userId: provisioningUserId,
      name: "AutoFlow",
      workspaceName: "AutoFlow Workspace",
      idempotencyKey: "alt-2090-repro",
      budgetMonthlyUsd: 1000,
      secretBindings: { OPENAI_API_KEY: "sk-test-1234" },
      agents: [{ roleTemplateId: "backend-engineer" }],
    });

    expect(controlPlaneStore.listTeams(provisioningUserId, workspaceId)).toHaveLength(1);
    expect(controlPlaneStore.listAgents(provisioned.team.id, provisioningUserId, workspaceId)).toHaveLength(1);

    expect(controlPlaneStore.listTeams(browserUserId, workspaceId)).toEqual([
      expect.objectContaining({ id: provisioned.team.id }),
    ]);
    expect(controlPlaneStore.getTeam(provisioned.team.id, browserUserId, workspaceId)).toEqual(
      expect.objectContaining({ id: provisioned.team.id })
    );
    expect(controlPlaneStore.listAgents(provisioned.team.id, browserUserId, workspaceId)).toEqual([
      expect.objectContaining({ id: provisioned.agents[0].id }),
    ]);
  });
});
