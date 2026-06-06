/**
 * HEL-650: action-handler identity/step threading + real webhook.send.
 *
 * Covers:
 *   - the foundation: a handler receives `step`, `userId`, `workspaceId`
 *     via ActionContext (the prerequisite for every connector handler);
 *   - the first real handler: `webhook.send` POSTs to a configured URL
 *     behind the SSRF guard, signs when a secret is present, fails honestly
 *     ({sent:false}) without a URL, and fails the step on an SSRF rejection;
 *   - no behavior change for the existing built-in (fewer-param) handlers.
 */

// Prevent transitive ESM import of @mistralai/mistralai via the llmProviders barrel.
jest.mock("./llmProviders", () => ({ getProvider: jest.fn() }));

// Stub the SSRF guard so tests don't hit real DNS / reachability checks.
jest.mock("../mcp/mcpUrlSecurity", () => ({
  assertSafeOutboundUrl: jest.fn(async () => "https://hook.example.com/in"),
  assertSafeMcpUrl: jest.fn(async () => undefined),
}));

import {
  WorkflowEngine,
  registerAction,
  setLlmProvider,
  type ActionContext,
} from "./WorkflowEngine";
import { assertSafeOutboundUrl } from "../mcp/mcpUrlSecurity";
import { runStore } from "./runStore";
import { approvalStore } from "./approvalStore";
import { approvalPolicyStore } from "../approvals/policyStore";
import { memoryStore } from "./memoryStore";
import { WorkflowRun, WorkflowTemplate } from "../types/workflow";

const mockAssertSafe = assertSafeOutboundUrl as jest.MockedFunction<typeof assertSafeOutboundUrl>;

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
let fetchMock: jest.Mock;

beforeEach(() => {
  void runStore.clear();
  void approvalStore.clear();
  void approvalPolicyStore.clear();
  memoryStore.clear();
  engine = new WorkflowEngine();
  setLlmProvider(async () => JSON.stringify({ result: "n/a" }));

  mockAssertSafe.mockReset();
  mockAssertSafe.mockResolvedValue("https://hook.example.com/in" as never);

  fetchMock = jest.fn(async () => ({ status: 200 }));
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
});

describe("WorkflowEngine action handlers — identity threading (HEL-650)", () => {
  it("threads step, userId and workspaceId into the action handler", async () => {
    let captured: ActionContext | undefined;
    registerAction("test.captureIdentity", async (_inputs, _config, action) => {
      captured = action;
      return { ok: true };
    });

    const run = await engine.startRun(
      oneActionStep("test.captureIdentity", { outputKeys: ["ok"] }),
      { workspaceId: "ws-1" },
      undefined,
      "user-1",
    );
    await waitForCompletion(run.id);

    expect(captured).toBeDefined();
    expect(captured!.userId).toBe("user-1");
    expect(captured!.workspaceId).toBe("ws-1");
    expect(captured!.step.id).toBe("step-1");
    expect(captured!.step.action).toBe("test.captureIdentity");
  });

  it("does not change behavior for existing fewer-param built-in handlers", async () => {
    // events.emit is a 1-arg (inputs-only) built-in — it must still run
    // unchanged under the 3-arg ActionContext threading.
    const run = await engine.startRun(
      oneActionStep("events.emit", { inputKeys: ["ticketId", "intent"], outputKeys: ["event"] }),
      { ticketId: "T-9", intent: "ticket", workspaceId: "ws-1" },
      undefined,
      "user-1",
    );
    const done = await waitForCompletion(run.id);
    expect(done.status).toBe("completed");
    expect(done.stepResults[0].output).toMatchObject({
      event: expect.objectContaining({ type: "ticket.resolved", id: "T-9" }),
    });
  });
});

describe("WorkflowEngine webhook.send (HEL-650)", () => {
  it("POSTs to the configured URL behind the SSRF guard with the step's inputs", async () => {
    const run = await engine.startRun(
      oneActionStep("webhook.send", {
        inputKeys: ["payload"],
        outputKeys: ["sent", "status"],
        config: { url: "https://hook.example.com/in", event: "lead.created" },
      }),
      { payload: "hello", workspaceId: "ws-1" },
      undefined,
      "user-1",
    );
    const done = await waitForCompletion(run.id);

    expect(done.status).toBe("completed");
    expect(mockAssertSafe).toHaveBeenCalledWith("https://hook.example.com/in");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0] as [string, { method: string; body: string; headers: Record<string, string> }];
    expect(call[0]).toBe("https://hook.example.com/in");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual({ event: "lead.created", data: { payload: "hello" } });
    // No secret declared → no signature header.
    expect(call[1].headers["X-AutoFlow-Signature"]).toBeUndefined();
    expect(done.stepResults[0].output).toMatchObject({ sent: true, status: 200 });
  });

  it("signs the body when an outboundWebhookSecret input is present", async () => {
    const run = await engine.startRun(
      oneActionStep("webhook.send", {
        inputKeys: ["payload", "outboundWebhookSecret"],
        outputKeys: ["sent"],
        config: { url: "https://hook.example.com/in" },
      }),
      { payload: "x", outboundWebhookSecret: "shh", workspaceId: "ws-1" },
      undefined,
      "user-1",
    );
    await waitForCompletion(run.id);

    const call = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(call[1].headers["X-AutoFlow-Signature"]).toEqual(expect.any(String));
  });

  it("fails honestly with {sent:false} and skips fetch when no URL is configured", async () => {
    const run = await engine.startRun(
      oneActionStep("webhook.send", { outputKeys: ["sent", "error"], config: {} }),
      { workspaceId: "ws-1" },
      undefined,
      "user-1",
    );
    const done = await waitForCompletion(run.id);

    expect(done.status).toBe("completed"); // soft failure, not a crash
    expect(fetchMock).not.toHaveBeenCalled();
    expect(done.stepResults[0].output).toMatchObject({ sent: false });
  });

  it("fails the step when the SSRF guard rejects the URL", async () => {
    mockAssertSafe.mockRejectedValueOnce(new Error("URL resolves to a private or internal address"));
    const run = await engine.startRun(
      oneActionStep("webhook.send", {
        outputKeys: ["sent"],
        config: { url: "http://169.254.169.254/latest/meta-data" },
      }),
      { workspaceId: "ws-1" },
      undefined,
      "user-1",
    );
    const done = await waitForCompletion(run.id);

    expect(done.status).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(done.stepResults[0].status).toBe("failure");
    expect(done.stepResults[0].error).toMatch(/private or internal/i);
  });
});
