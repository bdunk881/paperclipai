import { controlPlaneStore, resetControlPlaneStoreForTests } from "./controlPlaneStore";

describe("controlPlaneStore identity scoping", () => {
  beforeEach(() => {
    resetControlPlaneStoreForTests();
  });

  afterEach(() => {
    resetControlPlaneStoreForTests();
  });

  it("reproduces company workspace data remaining bound to the provisioning user", () => {
    const provisioningUserId = "agent-user";
    const browserUserId = "ceo-browser-user";
    const workspaceId = "11111111-1111-4111-8111-111111111111";

    const provisioned = controlPlaneStore.provisionCompanyWorkspace({
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

    // ALT-2090 reproduction: a second authenticated identity using the same
    // workspace context cannot see the company-scoped team or agents because
    // the control-plane store still filters by the provisioning userId.
    expect(controlPlaneStore.listTeams(browserUserId, workspaceId)).toEqual([]);
    expect(controlPlaneStore.getTeam(provisioned.team.id, browserUserId, workspaceId)).toBeUndefined();
    expect(controlPlaneStore.listAgents(provisioned.team.id, browserUserId, workspaceId)).toEqual([]);
  });
});
