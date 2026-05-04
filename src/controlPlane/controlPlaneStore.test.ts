import type { WorkflowStep } from "../types/workflow";
import { controlPlaneStore } from "./controlPlaneStore";

describe("controlPlaneStore workspace-scoped reads", () => {
  beforeEach(() => {
    controlPlaneStore.clear();
  });

  it("binds provisioned companies to the resolved workspace id and exposes teams to a second identity in that workspace", async () => {
    const provisioned = await controlPlaneStore.provisionCompanyWorkspace({
      workspaceId: "workspace-shared",
      userId: "provisioning-user",
      name: "Acme",
      idempotencyKey: "acme-1",
      budgetMonthlyUsd: 300,
      secretBindings: { OPENAI_API_KEY: "sk-acme-1234" },
      agents: [{ roleTemplateId: "backend-engineer" }],
    });

    expect(provisioned.company.workspaceId).toBe("workspace-shared");
    expect(controlPlaneStore.listTeams("ceo-user", "workspace-shared")).toEqual([
      expect.objectContaining({ id: provisioned.team.id }),
    ]);
    expect(controlPlaneStore.getTeam(provisioned.team.id, "ceo-user", "workspace-shared")).toEqual(
      expect.objectContaining({ id: provisioned.team.id })
    );
    expect(controlPlaneStore.listAllAgents("ceo-user", "workspace-shared")).toHaveLength(1);
    expect(controlPlaneStore.listTeams("ceo-user", "workspace-other")).toHaveLength(0);
  });

  it("exposes agents, executions, tasks, heartbeats, and spend snapshots through shared workspace access", async () => {
    const provisioned = await controlPlaneStore.provisionCompanyWorkspace({
      workspaceId: "workspace-shared",
      userId: "provisioning-user",
      name: "Acme",
      idempotencyKey: "acme-2",
      budgetMonthlyUsd: 300,
      secretBindings: { OPENAI_API_KEY: "sk-acme-1234" },
      agents: [{ roleTemplateId: "backend-engineer" }],
    });
    const step: WorkflowStep = {
      id: "step-1",
      name: "Handle CEO request",
      kind: "llm",
      description: "Respond to the CEO workflow request",
      inputKeys: [],
      outputKeys: [],
    };

    const started = await controlPlaneStore.startAgentExecution({
      workspaceId: "workspace-shared",
      userId: "provisioning-user",
      actor: "run-shared-workspace",
      teamId: provisioned.team.id,
      step,
      requestedAgentId: provisioned.agents[0].id,
      sourceRunId: "run-1",
      taskTitle: "Handle CEO request",
    });

    controlPlaneStore.recordSpend({
      userId: "provisioning-user",
      teamId: provisioned.team.id,
      agentId: started.agent.id,
      executionId: started.execution.id,
      category: "compute",
      costUsd: 1.25,
    });

    expect(controlPlaneStore.listAgents(provisioned.team.id, "ceo-user", "workspace-shared")).toEqual([
      expect.objectContaining({ id: started.agent.id }),
    ]);
    expect(controlPlaneStore.listExecutions("ceo-user", provisioned.team.id, "workspace-shared")).toEqual([
      expect.objectContaining({ id: started.execution.id }),
    ]);
    expect(controlPlaneStore.listTasks("ceo-user", provisioned.team.id, "workspace-shared")).toEqual([
      expect.objectContaining({ id: started.task?.id }),
    ]);
    expect(controlPlaneStore.listHeartbeats("ceo-user", provisioned.team.id, "workspace-shared")).toHaveLength(1);
    expect(
      controlPlaneStore.listAgentHeartbeats(started.agent.id, "ceo-user", "workspace-shared")
    ).toHaveLength(1);
    expect(
      controlPlaneStore.getTeamSpendSnapshot(provisioned.team.id, "ceo-user", "workspace-shared")
    ).toEqual(
      expect.objectContaining({
        team: expect.objectContaining({ spentUsd: 1.25 }),
      })
    );
  });

  it("resets a legacy error status on successful heartbeat activity", async () => {
    const provisioned = await controlPlaneStore.provisionCompanyWorkspace({
      workspaceId: "workspace-shared",
      userId: "provisioning-user",
      name: "Acme",
      idempotencyKey: "acme-3",
      budgetMonthlyUsd: 300,
      secretBindings: { OPENAI_API_KEY: "sk-acme-1234" },
      agents: [{ roleTemplateId: "backend-engineer" }],
    });
    const step: WorkflowStep = {
      id: "step-2",
      name: "Recover runtime state",
      kind: "llm",
      description: "Resume the agent after a stale error state",
      inputKeys: [],
      outputKeys: [],
    };

    const started = await controlPlaneStore.startAgentExecution({
      workspaceId: "workspace-shared",
      userId: "provisioning-user",
      actor: "run-reset-error-status",
      teamId: provisioned.team.id,
      step,
      requestedAgentId: provisioned.agents[0].id,
      sourceRunId: "run-reset-1",
    });

    const staleAgent = controlPlaneStore.getAgent(
      provisioned.agents[0].id,
      "provisioning-user",
      "workspace-shared"
    )!;

    (staleAgent as { status: string | typeof staleAgent.status }).status = "error";

    await controlPlaneStore.recordHeartbeat({
      workspaceId: "workspace-shared",
      userId: "provisioning-user",
      teamId: provisioned.team.id,
      agentId: staleAgent.id,
      executionId: started.execution.id,
      status: "running",
      summary: "Recovered after restart",
    });

    expect(staleAgent.status).toBe("active");

    (staleAgent as { status: string | typeof staleAgent.status }).status = "error";

    const completed = await controlPlaneStore.finalizeAgentExecution({
      workspaceId: "workspace-shared",
      executionId: started.execution.id,
      userId: "provisioning-user",
      status: "completed",
      summary: "Recovered cleanly",
    });

    expect(completed.status).toBe("completed");
    expect(staleAgent.status).toBe("active");
    expect(controlPlaneStore.getAgent(staleAgent.id, "provisioning-user", "workspace-shared")?.status).toBe("active");
  });
});
