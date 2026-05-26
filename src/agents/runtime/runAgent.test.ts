import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { backendNameFor, isAgentSdkEnabled, pickBackend } from "./runAgent";

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
