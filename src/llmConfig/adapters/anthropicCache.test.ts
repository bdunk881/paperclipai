/**
 * Tests for buildSystemParam (HEL-628): the Anthropic prompt-cache breakpoint
 * on the system block.
 */
import { describe, expect, it } from "@jest/globals";

import { buildSystemParam } from "./anthropicAdapter";

describe("buildSystemParam (HEL-628 prompt caching)", () => {
  it("returns undefined for an empty system prompt", () => {
    expect(buildSystemParam("", true)).toBeUndefined();
    expect(buildSystemParam("", false)).toBeUndefined();
  });

  it("returns the plain string when caching is off", () => {
    expect(buildSystemParam("you are an agent", false)).toBe("you are an agent");
  });

  it("stamps an ephemeral cache_control breakpoint on the system block when on", () => {
    expect(buildSystemParam("you are an agent", true)).toEqual([
      { type: "text", text: "you are an agent", cache_control: { type: "ephemeral" } },
    ]);
  });
});
