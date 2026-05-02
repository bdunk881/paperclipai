import type { WorkflowStep } from "../types/workflow";
import { controlPlaneStore } from "./controlPlaneStore";

describe("controlPlaneStore", () => {
  beforeEach(() => {
    controlPlaneStore.clear();
  });

  it("resets a legacy error status on successful heartbeat activity", async () => {
    const provisioned = await controlPlaneStore.provisionCompanyWorkspace({
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
      userId: "provisioning-user",
      actor: "run-reset-error-status",
      teamId: provisioned.team.id,
      step,
      requestedAgentId: provisioned.agents[0].id,
      sourceRunId: "run-reset-1",
    });

    const staleAgent = controlPlaneStore.getAgent(provisioned.agents[0].id, "provisioning-user")!;

    (staleAgent as { status: string | typeof staleAgent.status }).status = "error";

    await controlPlaneStore.recordHeartbeat({
      userId: "provisioning-user",
      teamId: provisioned.team.id,
      agentId: staleAgent.id,
      executionId: started.execution.id,
      status: "running",
      summary: "Recovered after restart",
    });

    expect(staleAgent.status).toBe("active");

    (staleAgent as { status: string | typeof staleAgent.status }).status = "error";

    const completed = controlPlaneStore.finalizeAgentExecution({
      executionId: started.execution.id,
      userId: "provisioning-user",
      status: "completed",
      summary: "Recovered cleanly",
    });

    expect(completed.status).toBe("completed");
    expect(staleAgent.status).toBe("active");
    expect(controlPlaneStore.getAgent(staleAgent.id, "provisioning-user")?.status).toBe("active");
  });
});
