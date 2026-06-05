/**
 * HEL-656: capability registry + dynamic action dispatch (spine of HEL-647).
 *
 * Covers:
 *   - the registry registers the built-in connector actions (slack.notify);
 *   - executeAction dispatches a registered connector action with the run
 *     owner's userId + connectionId (via a custom probe action);
 *   - slack.notify performs a real send via the connector (mocked) and fails
 *     honestly when not connected / no channel / no run user;
 *   - an action absent from the library falls through to the legacy registry.
 */

// Prevent transitive ESM import of @mistralai/mistralai via the llmProviders barrel.
jest.mock("./llmProviders", () => ({ getProvider: jest.fn() }));

// The slack seed lazily imports this inside invoke(); mock it so no real
// credential/network path is exercised.
jest.mock("../integrations/slack/service", () => ({
  slackConnectorService: { sendMessage: jest.fn() },
}));

import {
  WorkflowEngine,
  setLlmProvider,
} from "./WorkflowEngine";
import {
  getConnectorAction,
  listConnectorActions,
  registerConnectorAction,
} from "./connectorActions";
import { slackConnectorService } from "../integrations/slack/service";
import { runStore } from "./runStore";
import { approvalStore } from "./approvalStore";
import { approvalPolicyStore } from "../approvals/policyStore";
import { memoryStore } from "./memoryStore";
import { WorkflowRun, WorkflowTemplate } from "../types/workflow";

const mockSend = slackConnectorService.sendMessage as jest.MockedFunction<
  typeof slackConnectorService.sendMessage
>;

async function waitForCompletion(runId: string, timeoutMs = 3000): Promise<WorkflowRun> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await runStore.get(runId);
    if (run && ["completed", "failed"].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 10));
  }
  const run = await runStore.get(runId);
  throw new Error(`Run ${runId} did not terminate (last status: ${run?.status})`);
}

function oneActionStep(
  action: string,
  opts: { inputKeys?: string[]; outputKeys?: string[]; config?: Record<string, unknown> } = {},
): WorkflowTemplate {
  return {
    id: "tpl-action",
    name: "Action template",
    description: "single action step",
    category: "custom",
    version: "1",
    configFields: [],
    steps: [
      {
        id: "step-1",
        name: "The action",
        kind: "action",
        description: "action step",
        inputKeys: opts.inputKeys ?? [],
        outputKeys: opts.outputKeys ?? [],
        action,
        ...(opts.config ? { config: opts.config } : {}),
      },
    ],
    sampleInput: {},
    expectedOutput: {},
  };
}

let engine: WorkflowEngine;

beforeEach(() => {
  void runStore.clear();
  void approvalStore.clear();
  void approvalPolicyStore.clear();
  memoryStore.clear();
  engine = new WorkflowEngine();
  setLlmProvider(async () => JSON.stringify({ result: "n/a" }));
  jest.clearAllMocks();
  mockSend.mockResolvedValue({ ts: "1700000000.000100", channel: "C123" } as never);
});

describe("connector-action registry (HEL-656)", () => {
  it("registers the built-in slack actions", () => {
    expect(getConnectorAction("slack.notify")).toBeDefined();
    expect(getConnectorAction("slack.dispatchNotification")).toBeDefined();
    expect(listConnectorActions().map((a) => a.actionId)).toEqual(
      expect.arrayContaining(["slack.notify", "slack.dispatchNotification"]),
    );
  });

  it("dispatches a registered connector action with the run owner's userId + connectionId", async () => {
    const invoke = jest.fn(async () => ({ ok: true }));
    registerConnectorAction({
      connectorKey: "test",
      actionId: "test.custom",
      label: "Custom",
      isWrite: false,
      invoke,
    });

    const run = await engine.startRun(
      oneActionStep("test.custom", {
        inputKeys: ["x"],
        outputKeys: ["ok"],
        config: { connectionId: "conn-9" },
      }),
      { x: "v", workspaceId: "ws-1" },
      undefined,
      "user-1",
    );
    const done = await waitForCompletion(run.id);

    expect(done.status).toBe("completed");
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        connectionId: "conn-9",
        inputs: { x: "v" },
        step: expect.objectContaining({ action: "test.custom" }),
      }),
    );
  });

  it("an action not in the library falls through to the legacy registry", async () => {
    expect(getConnectorAction("crm.upsertLead")).toBeUndefined();
    const run = await engine.startRun(
      oneActionStep("crm.upsertLead", { inputKeys: ["email"], outputKeys: ["crmId", "upserted"] }),
      { email: "lead@example.com", workspaceId: "ws-1" },
      undefined,
      "user-1",
    );
    const done = await waitForCompletion(run.id);
    expect(done.status).toBe("completed");
    expect(done.stepResults[0].output).toMatchObject({ upserted: true });
  });
});

describe("slack.notify via the dynamic library (HEL-656)", () => {
  it("dispatches to the connector with the run owner's userId + resolved channel/text", async () => {
    const run = await engine.startRun(
      oneActionStep("slack.notify", {
        inputKeys: ["message"],
        outputKeys: ["sent", "channel", "ts"],
        config: { channel: "C123", message: "hello team" },
      }),
      { message: "ignored-by-config", workspaceId: "ws-1" },
      undefined,
      "user-1",
    );
    const done = await waitForCompletion(run.id);

    expect(done.status).toBe("completed");
    // step.config.message wins over the input; channel from step.config.
    expect(mockSend).toHaveBeenCalledWith("user-1", "C123", "hello team");
    expect(done.stepResults[0].output).toMatchObject({
      sent: true,
      channel: "C123",
      ts: "1700000000.000100",
    });
  });

  it("fails the step honestly when Slack is not connected", async () => {
    mockSend.mockRejectedValueOnce(new Error("Slack connector is not configured"));
    const run = await engine.startRun(
      oneActionStep("slack.notify", { outputKeys: ["sent"], config: { channel: "C1", message: "hi" } }),
      { workspaceId: "ws-1" },
      undefined,
      "user-1",
    );
    const done = await waitForCompletion(run.id);

    expect(done.status).toBe("failed");
    expect(done.stepResults[0].status).toBe("failure");
    expect(done.stepResults[0].error).toMatch(/not configured/i);
    expect(mockSend).toHaveBeenCalled();
  });

  it("fails honestly (no send) when the run has no user", async () => {
    const run = await engine.startRun(
      oneActionStep("slack.notify", { outputKeys: ["sent"], config: { channel: "C1", message: "hi" } }),
      { workspaceId: "ws-1" },
      // no userId
    );
    const done = await waitForCompletion(run.id);

    expect(done.status).toBe("failed");
    expect(done.stepResults[0].error).toMatch(/needs a run user/i);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("fails honestly (no send) when no channel is configured", async () => {
    const run = await engine.startRun(
      oneActionStep("slack.notify", { outputKeys: ["sent"], config: {} }),
      { workspaceId: "ws-1" },
      undefined,
      "user-1",
    );
    const done = await waitForCompletion(run.id);

    expect(done.status).toBe("failed");
    expect(done.stepResults[0].error).toMatch(/no channel/i);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
