jest.mock("./llmProviders", () => ({
  getProvider: jest.fn(),
}));

import { approvalStore } from "./approvalStore";
import { approvalNotificationStore } from "./approvalNotificationStore";
import { workflowEngine } from "./WorkflowEngine";
import { runStore } from "./runStore";
import {
  runApprovalResumeSweep,
  startApprovalResumeCoordinator,
  stopApprovalResumeCoordinator,
} from "./approvalResumeCoordinator";
import { TEMPLATE_MAP } from "../templates";

async function waitForRunStatus(
  runId: string,
  expected: string,
  timeoutMs = 3000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await runStore.get(runId);
    if (run?.status === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Run ${runId} did not reach status ${expected}`);
}

beforeEach(async () => {
  await approvalStore.clear();
  await approvalNotificationStore.clear();
  await runStore.clear();
});

describe("runApprovalResumeSweep", () => {
  it("resumes an awaiting approval run once the decision is already persisted", async () => {
    const waitSpy = jest.spyOn(approvalStore, "waitForDecision").mockImplementation(
      async () => await new Promise(() => {})
    );

    const template = {
      id: "tpl-coordinator-resume",
      name: "Coordinator resume",
      description: "Resume via coordinator sweep",
      category: "custom" as const,
      version: "1",
      configFields: [],
      steps: [
        {
          id: "trigger-1",
          name: "Trigger",
          kind: "trigger" as const,
          description: "Start",
          inputKeys: ["message"],
          outputKeys: ["message"],
        },
        {
          id: "approval-1",
          name: "Approval",
          kind: "approval" as const,
          description: "Pause",
          inputKeys: ["message"],
          outputKeys: ["approved"],
          approvalAssignee: "manager",
          approvalMessage: "Please approve",
          approvalTimeoutMinutes: 5,
        },
        {
          id: "output-1",
          name: "Output",
          kind: "output" as const,
          description: "Finish",
          inputKeys: ["message", "approvalDecision"],
          outputKeys: ["message", "approvalDecision"],
        },
      ],
      sampleInput: { message: "hello" },
      expectedOutput: { message: "hello" },
    };

    TEMPLATE_MAP[template.id] = template;

    const run = await workflowEngine.startRun(template, { message: "hello" });
    await waitForRunStatus(run.id, "awaiting_approval");

    const pendingApproval = await approvalStore.findByRunId(run.id, "pending");
    expect(pendingApproval).toBeDefined();
    await approvalStore.resolve(pendingApproval!.id, "approved", "resume automatically");

    const sweep = await runApprovalResumeSweep();
    expect(sweep.resumed).toBe(1);

    await waitForRunStatus(run.id, "completed");
    await expect(runStore.get(run.id)).resolves.toMatchObject({
      output: {
        message: "hello",
        approvalDecision: "approved",
      },
    });

    waitSpy.mockRestore();
    delete TEMPLATE_MAP[template.id];
  });

  it("skips runs whose approval is still pending", async () => {
    const waitSpy = jest.spyOn(approvalStore, "waitForDecision").mockImplementation(
      async () => await new Promise(() => {})
    );

    const template = {
      id: "tpl-coordinator-pending",
      name: "Coordinator pending",
      description: "Pending approvals should not resume",
      category: "custom" as const,
      version: "1",
      configFields: [],
      steps: [
        {
          id: "trigger-1",
          name: "Trigger",
          kind: "trigger" as const,
          description: "Start",
          inputKeys: ["message"],
          outputKeys: ["message"],
        },
        {
          id: "approval-1",
          name: "Approval",
          kind: "approval" as const,
          description: "Pause",
          inputKeys: ["message"],
          outputKeys: ["approved"],
          approvalAssignee: "manager",
          approvalMessage: "Please approve",
          approvalTimeoutMinutes: 5,
        },
      ],
      sampleInput: { message: "hello" },
      expectedOutput: { message: "hello" },
    };

    TEMPLATE_MAP[template.id] = template;

    const run = await workflowEngine.startRun(template, { message: "hello" });
    await waitForRunStatus(run.id, "awaiting_approval");

    const sweep = await runApprovalResumeSweep();
    expect(sweep.resumed).toBe(0);
    expect(sweep.skippedPending).toBe(1);
    await expect(runStore.get(run.id)).resolves.toMatchObject({ status: "awaiting_approval" });

    waitSpy.mockRestore();
    delete TEMPLATE_MAP[template.id];
  });

  it("skips awaiting approval runs that are missing a waitingApprovalId snapshot", async () => {
    await runStore.create({
      id: "run-missing-snapshot",
      templateId: "tpl-missing-snapshot",
      templateName: "Missing snapshot",
      status: "awaiting_approval",
      startedAt: new Date().toISOString(),
      input: {},
      stepResults: [],
      runtimeState: {
        config: {},
        context: {},
        currentStepIndex: 0,
      },
    });

    await expect(runApprovalResumeSweep()).resolves.toMatchObject({
      scanned: 1,
      skippedMissingSnapshot: 1,
      resumed: 0,
    });
  });

  it("skips awaiting approval runs when the template can no longer be loaded", async () => {
    const approval = await approvalStore.create({
      runId: "run-missing-template",
      templateName: "Missing template",
      stepId: "approval-1",
      stepName: "Manager Approval",
      assignee: "manager",
      message: "Please approve",
      timeoutMinutes: 5,
    });
    await approvalStore.resolve(approval.id, "approved");
    await runStore.create({
      id: "run-missing-template",
      templateId: "tpl-missing-template",
      templateName: "Missing template",
      status: "awaiting_approval",
      startedAt: new Date().toISOString(),
      input: {},
      stepResults: [],
      runtimeState: {
        config: {},
        context: {},
        currentStepIndex: 0,
        waitingApprovalId: approval.id,
      },
    });

    await expect(runApprovalResumeSweep()).resolves.toMatchObject({
      scanned: 1,
      skippedMissingSnapshot: 1,
      resumed: 0,
    });
  });

  it("does not crash startup when persisted workflow tables are missing", async () => {
    const listSpy = jest
      .spyOn(runStore, "list")
      .mockRejectedValueOnce(new Error('relation "workflow_runs" does not exist'));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    await expect(runApprovalResumeSweep()).resolves.toMatchObject({
      scanned: 0,
      resumed: 0,
      skippedPending: 0,
      skippedMissingSnapshot: 0,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "[approval] Resume sweep skipped:",
      'relation "workflow_runs" does not exist'
    );

    listSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe("approval resume coordinator lifecycle", () => {
  afterEach(() => {
    stopApprovalResumeCoordinator();
    jest.useRealTimers();
  });

  it("returns zeroed counters when runStore.list() throws an Error", async () => {
    jest.spyOn(runStore, "list").mockRejectedValueOnce(new Error("table missing"));
    const result = await runApprovalResumeSweep();
    expect(result).toEqual({ scanned: 0, resumed: 0, skippedPending: 0, skippedMissingSnapshot: 0 });
  });

  it("returns zeroed counters when runStore.list() throws a non-Error", async () => {
    jest.spyOn(runStore, "list").mockRejectedValueOnce("string rejection");
    const result = await runApprovalResumeSweep();
    expect(result).toEqual({ scanned: 0, resumed: 0, skippedPending: 0, skippedMissingSnapshot: 0 });
  });

  it("starts only one interval and stops cleanly", () => {
    jest.useFakeTimers();
    const setIntervalSpy = jest.spyOn(global, "setInterval");
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");

    startApprovalResumeCoordinator(100);
    startApprovalResumeCoordinator(100);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    stopApprovalResumeCoordinator();
    stopApprovalResumeCoordinator();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
