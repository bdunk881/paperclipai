import { describe, expect, it } from "@jest/globals";

import { BACKEND_CAPABILITIES, getBackendCapabilities } from "./capabilities";

describe("backend capabilities", () => {
  it("flags claude_sdk as full-native", () => {
    expect(getBackendCapabilities("claude_sdk")).toEqual({
      toolLoop: true,
      nativeSubagents: true,
      nativeMcp: true,
      nativeSkills: true,
      nativeStreamingTrace: true,
    });
  });

  it("flags openai_agents as native except for skills", () => {
    expect(getBackendCapabilities("openai_agents").nativeSkills).toBe(false);
    expect(getBackendCapabilities("openai_agents").nativeSubagents).toBe(true);
  });

  it("flags fallback as toolLoop-only", () => {
    const fallback = getBackendCapabilities("fallback");
    expect(fallback.toolLoop).toBe(true);
    expect(fallback.nativeSubagents).toBe(false);
    expect(fallback.nativeMcp).toBe(false);
    expect(fallback.nativeSkills).toBe(false);
    expect(fallback.nativeStreamingTrace).toBe(false);
  });

  it("exposes the same map via the constant and the helper", () => {
    expect(getBackendCapabilities("fallback")).toBe(BACKEND_CAPABILITIES.fallback);
  });
});
