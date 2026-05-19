import type { WorkflowStep } from "../types/workflow";
import { controlPlaneRepository } from "./controlPlaneRepository";
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
    // DASH-64.6: listTeams + getTeam are async now (repo-backed).
    expect(await controlPlaneStore.listTeams("ceo-user", "workspace-shared")).toEqual([
      expect.objectContaining({ id: provisioned.team.id }),
    ]);
    expect(await controlPlaneStore.getTeam(provisioned.team.id, "ceo-user", "workspace-shared")).toEqual(
      expect.objectContaining({ id: provisioned.team.id })
    );
    // DASH-64.5: listAllAgents is async now (repo-backed).
    expect(await controlPlaneStore.listAllAgents("ceo-user", "workspace-shared")).toHaveLength(1);
    expect(await controlPlaneStore.listTeams("ceo-user", "workspace-other")).toHaveLength(0);
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

    // DASH-64.5: listAgents is now async (repository-backed).
    expect(await controlPlaneStore.listAgents(provisioned.team.id, "ceo-user", "workspace-shared")).toEqual([
      expect.objectContaining({ id: started.agent.id }),
    ]);
    // DASH-64.4: listExecutions is now async (repository-backed).
    expect(await controlPlaneStore.listExecutions("ceo-user", provisioned.team.id, "workspace-shared")).toEqual([
      expect.objectContaining({ id: started.execution.id }),
    ]);
    // DASH-64.1: listTasks is now async (repository-backed).
    expect(await controlPlaneStore.listTasks("ceo-user", provisioned.team.id, "workspace-shared")).toEqual([
      expect.objectContaining({ id: started.task?.id }),
    ]);
    // DASH-64.2: listHeartbeats + listAgentHeartbeats are now async
    // (repository-backed).
    expect(await controlPlaneStore.listHeartbeats("ceo-user", provisioned.team.id, "workspace-shared")).toHaveLength(1);
    expect(
      await controlPlaneStore.listAgentHeartbeats(started.agent.id, "ceo-user", "workspace-shared")
    ).toHaveLength(1);
    // DASH-64.3: getTeamSpendSnapshot is now async.
    expect(
      await controlPlaneStore.getTeamSpendSnapshot(provisioned.team.id, "ceo-user", "workspace-shared")
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

    // DASH-64.5: getAgent is async; agents are returned as fresh copies
    // from the repository on each call (no shared-reference aliasing
    // through the legacy in-memory Map). The "stale error status reset"
    // behaviour is verified by reading the agent back after each mutator.
    const staleAgent = (await controlPlaneStore.getAgent(
      provisioned.agents[0].id,
      "provisioning-user",
      "workspace-shared"
    ))!;

    // Force a stale "error" status into the repository so recordHeartbeat
    // can prove it recovers it back to "active".
    const repoCtx = { workspaceId: "workspace-shared", userId: "provisioning-user" };
    await controlPlaneRepository.upsertAgent(repoCtx, {
      ...staleAgent,
      status: "error" as unknown as typeof staleAgent.status,
    });

    await controlPlaneStore.recordHeartbeat({
      workspaceId: "workspace-shared",
      userId: "provisioning-user",
      teamId: provisioned.team.id,
      agentId: staleAgent.id,
      executionId: started.execution.id,
      status: "running",
      summary: "Recovered after restart",
    });

    expect(
      (await controlPlaneStore.getAgent(staleAgent.id, "provisioning-user", "workspace-shared"))?.status
    ).toBe("active");

    // Force another stale "error" status to verify finalizeAgentExecution
    // also normalizes it.
    await controlPlaneRepository.upsertAgent(repoCtx, {
      ...staleAgent,
      status: "error" as unknown as typeof staleAgent.status,
    });

    const completed = await controlPlaneStore.finalizeAgentExecution({
      workspaceId: "workspace-shared",
      executionId: started.execution.id,
      userId: "provisioning-user",
      status: "completed",
      summary: "Recovered cleanly",
    });

    expect(completed.status).toBe("completed");
    expect(
      (await controlPlaneStore.getAgent(staleAgent.id, "provisioning-user", "workspace-shared"))?.status
    ).toBe("active");
  });
});
