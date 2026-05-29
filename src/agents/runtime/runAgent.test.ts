import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@sentry/node", () => ({
  // Run the callback synchronously and return its value, mirroring the real
  // withIsolationScope contract, so the wrapped fn actually executes.
  withIsolationScope: jest.fn((cb: () => unknown) => cb()),
  setConversationId: jest.fn(),
}));

import * as Sentry from "@sentry/node";
import {
  backendNameFor,
  isAgentSdkEnabled,
  pickBackend,
  withAgentConversation,
} from "./runAgent";

const SDK_ENV = "AUTOFLOW_AGENT_SDK_ENABLED";

describe("runAgent backend selection", () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env[SDK_ENV];
  });

  afterEach(() => {
    if (prev === undefined) delete process.env[SDK_ENV];
    else process.env[SDK_ENV] = prev;
  });

  it("defaults to the fallback backend when the SDK flag is not set", () => {
    delete process.env[SDK_ENV];
    expect(isAgentSdkEnabled()).toBe(false);
    expect(pickBackend("anthropic").name).toBe("fallback");
    expect(pickBackend("openai").name).toBe("fallback");
    expect(pickBackend("gemini").name).toBe("fallback");
  });

  it("routes anthropic and openai to native SDK backends when AUTOFLOW_AGENT_SDK_ENABLED=1", () => {
    process.env[SDK_ENV] = "1";
    expect(isAgentSdkEnabled()).toBe(true);
    expect(backendNameFor("anthropic")).toBe("claude_sdk");
    expect(backendNameFor("openai")).toBe("openai_agents");
  });

  it("keeps non-Anthropic/non-OpenAI providers on the fallback backend even when the SDK flag is set", () => {
    process.env[SDK_ENV] = "1";
    expect(backendNameFor("gemini")).toBe("fallback");
    expect(backendNameFor("bedrock")).toBe("fallback");
    expect(backendNameFor("mistral")).toBe("fallback");
    expect(backendNameFor("vertex-ai")).toBe("fallback");
  });

  it("treats AUTOFLOW_AGENT_SDK_ENABLED='true' as enabled", () => {
    process.env[SDK_ENV] = "true";
    expect(isAgentSdkEnabled()).toBe(true);
    expect(backendNameFor("anthropic")).toBe("claude_sdk");
  });
});

describe("withAgentConversation (HEL-321)", () => {
  const setConversationId = jest.mocked(Sentry.setConversationId);
  const withIsolationScope = jest.mocked(Sentry.withIsolationScope);

  beforeEach(() => {
    // mockClear (not mockReset) so withIsolationScope keeps its callback-
    // invoking implementation from the mock factory.
    setConversationId.mockClear();
    withIsolationScope.mockClear();
  });

  it("tags the run with its runId inside an isolation scope and returns the inner result", async () => {
    const result = await withAgentConversation(
      { runId: "run_123", agentId: "agent_abc" },
      async () => "done",
    );

    expect(result).toBe("done");
    expect(withIsolationScope).toHaveBeenCalledTimes(1);
    expect(setConversationId).toHaveBeenCalledWith("run_123");
  });

  it("falls back to agent:<agentId> when there is no runId", async () => {
    await withAgentConversation({ agentId: "agent_abc" }, async () => undefined);
    expect(setConversationId).toHaveBeenCalledWith("agent:agent_abc");
  });

  it("sets the conversation id before invoking the wrapped fn", async () => {
    const order: string[] = [];
    setConversationId.mockImplementation(() => {
      order.push("setConversationId");
    });
    await withAgentConversation({ runId: "run_xyz", agentId: "a" }, async () => {
      order.push("fn");
    });
    expect(order).toEqual(["setConversationId", "fn"]);
  });

  it("propagates rejections from the wrapped fn", async () => {
    await expect(
      withAgentConversation({ runId: "run_err", agentId: "a" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
