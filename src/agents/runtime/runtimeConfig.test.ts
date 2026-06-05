/**
 * Tests for readRuntimeNumber (HEL-629) — the shared reader for per-agent
 * `agents.metadata.runtime.*` overrides used by truncation / retry / compaction
 * / maxToolIterations.
 */
import { describe, expect, it } from "@jest/globals";

import { readRuntimeNumber } from "./runtimeConfig";

describe("readRuntimeNumber", () => {
  it("reads a positive number from metadata.runtime[key]", () => {
    expect(readRuntimeNumber({ runtime: { maxToolIterations: 12 } }, "maxToolIterations")).toBe(12);
    expect(readRuntimeNumber({ runtime: { toolResultMaxChars: 5000 } }, "toolResultMaxChars")).toBe(
      5000,
    );
  });

  it("honours 0 (used to disable a feature for an agent)", () => {
    expect(readRuntimeNumber({ runtime: { toolResultMaxChars: 0 } }, "toolResultMaxChars")).toBe(0);
  });

  it("returns undefined for missing / wrong-shape / invalid values", () => {
    expect(readRuntimeNumber(undefined, "k")).toBeUndefined();
    expect(readRuntimeNumber(null, "k")).toBeUndefined();
    expect(readRuntimeNumber({}, "k")).toBeUndefined();
    expect(readRuntimeNumber({ runtime: null }, "k")).toBeUndefined();
    expect(readRuntimeNumber({ runtime: {} }, "k")).toBeUndefined();
    expect(readRuntimeNumber({ runtime: { k: "nope" } }, "k")).toBeUndefined();
    expect(readRuntimeNumber({ runtime: { k: -1 } }, "k")).toBeUndefined();
    expect(readRuntimeNumber({ runtime: { k: Number.NaN } }, "k")).toBeUndefined();
    expect(readRuntimeNumber({ runtime: { k: Infinity } }, "k")).toBeUndefined();
  });
});
