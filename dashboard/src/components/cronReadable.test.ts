/**
 * Coverage for the cron-to-English helper (Wave 4). Small-business
 * owners shouldn't have to read `0 9 * * 1-5`.
 */

import { describe, expect, it } from "vitest";
import { readableCron } from "./cronReadable";

describe("readableCron", () => {
  it("returns 'Not scheduled' for null / empty / whitespace", () => {
    expect(readableCron(null).label).toBe("Not scheduled");
    expect(readableCron("").label).toBe("Not scheduled");
    expect(readableCron("   ").label).toBe("Not scheduled");
  });

  it("handles 'every weekday at 9 am'", () => {
    const out = readableCron("0 9 * * 1-5");
    expect(out.label).toBe("Every weekday at 9 am UTC");
    expect(out.recognized).toBe(true);
  });

  it("handles 'every day at 2:30 pm'", () => {
    const out = readableCron("30 14 * * *");
    expect(out.label).toBe("Every day at 2:30 pm UTC");
    expect(out.recognized).toBe(true);
  });

  it("handles 'every Monday at 8 am'", () => {
    const out = readableCron("0 8 * * 1");
    expect(out.label).toBe("Every Monday at 8 am UTC");
    expect(out.recognized).toBe(true);
  });

  it("handles 'every 2 hours'", () => {
    const out = readableCron("0 */2 * * *");
    expect(out.label).toBe("Every 2 hours");
    expect(out.recognized).toBe(true);
  });

  it("handles 'first of every month at 8 am'", () => {
    const out = readableCron("0 8 1 * *");
    expect(out.label).toBe("First of every month at 8 am UTC");
    expect(out.recognized).toBe(true);
  });

  it("falls back to the raw cron when the pattern isn't recognized", () => {
    // Every 15 min isn't in our explicit pattern set — should pass through raw.
    const out = readableCron("*/15 * * * *");
    expect(out.label).toBe("*/15 * * * *");
    expect(out.recognized).toBe(false);
  });

  it("falls back when the expression doesn't have 5 parts", () => {
    const out = readableCron("0 9 *");
    expect(out.recognized).toBe(false);
  });
});
