/**
 * HEL-500: boot-time required-secret assertion.
 */

import {
  assertRequiredSecrets,
  checkRequiredSecrets,
  isRedisConfigured,
} from "./requiredSecrets";

const FULL_ENV = {
  NODE_ENV: "production",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "svc-key",
  CONTROL_PLANE_SECRET_KEY: "a".repeat(64),
  MFA_RP_ID: "app.helloautoflow.com",
  MFA_RP_NAME: "AutoFlow",
  MFA_ORIGIN: "https://app.helloautoflow.com",
  REDIS_URL: "redis://localhost:6379",
  OPENCODE_ZEN_API_KEY: "ocz-test-key",
} as Record<string, string>;

describe("checkRequiredSecrets (HEL-500)", () => {
  it("reports nothing missing when every secret is set", () => {
    const result = checkRequiredSecrets(FULL_ENV);
    expect(result.missingRequired).toHaveLength(0);
    expect(result.missingRecommended).toHaveLength(0);
  });

  it("flags the three core secrets as required when unset", () => {
    const result = checkRequiredSecrets({ NODE_ENV: "production" });
    const names = result.missingRequired.map((s) => s.name);
    expect(names).toEqual([
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "CONTROL_PLANE_SECRET_KEY",
    ]);
  });

  it("treats MFA_* as recommended (not required) because they have localhost fallbacks", () => {
    const result = checkRequiredSecrets({ ...FULL_ENV, MFA_RP_ID: "", MFA_ORIGIN: "" });
    expect(result.missingRequired).toHaveLength(0);
    const names = result.missingRecommended.map((s) => s.name);
    expect(names).toContain("MFA_RP_ID");
    expect(names).toContain("MFA_ORIGIN");
  });

  it("flags OPENCODE_ZEN_API_KEY as recommended (HEL-420) — feature-gates the Explore free tier", () => {
    const result = checkRequiredSecrets({ ...FULL_ENV, OPENCODE_ZEN_API_KEY: "" });
    // Warn-only — the app stays up (BYOK keeps working), so it must not be required.
    expect(result.missingRequired).toHaveLength(0);
    expect(result.missingRecommended.map((s) => s.name)).toContain("OPENCODE_ZEN_API_KEY");
  });
});

describe("isRedisConfigured (HEL-500)", () => {
  it("accepts REDIS_URL", () => {
    expect(isRedisConfigured({ REDIS_URL: "redis://x" })).toBe(true);
  });

  it("accepts UPSTASH_REDIS_URL", () => {
    expect(isRedisConfigured({ UPSTASH_REDIS_URL: "rediss://x" })).toBe(true);
  });

  it("accepts the Upstash REST pair only when BOTH are set", () => {
    expect(isRedisConfigured({ UPSTASH_REDIS_REST_URL: "https://x" })).toBe(false);
    expect(
      isRedisConfigured({ UPSTASH_REDIS_REST_URL: "https://x", UPSTASH_REDIS_REST_TOKEN: "tok" }),
    ).toBe(true);
  });

  it("flags Redis as recommended-missing when no group is configured", () => {
    const result = checkRequiredSecrets({ ...FULL_ENV, REDIS_URL: "" });
    expect(result.missingRecommended.map((s) => s.name)).toEqual(
      expect.arrayContaining([expect.stringContaining("REDIS_URL")]),
    );
  });
});

describe("assertRequiredSecrets (HEL-500)", () => {
  function spies() {
    return {
      logger: { warn: jest.fn(), error: jest.fn() },
      exit: jest.fn(),
    };
  }

  it("exits(1) in production when a required secret is missing", () => {
    const { logger, exit } = spies();
    assertRequiredSecrets({ env: { NODE_ENV: "production" }, logger, exit });
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalled();
  });

  it("does NOT exit in non-production even when required secrets are missing", () => {
    const { logger, exit } = spies();
    assertRequiredSecrets({ env: { NODE_ENV: "development" }, logger, exit });
    expect(exit).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("does NOT exit in production when all required secrets are present", () => {
    const { logger, exit } = spies();
    const result = assertRequiredSecrets({ env: FULL_ENV, logger, exit });
    expect(exit).not.toHaveBeenCalled();
    expect(result.missingRequired).toHaveLength(0);
  });

  it("warns (never exits) for missing recommended secrets in production", () => {
    const { logger, exit } = spies();
    const env = { ...FULL_ENV, MFA_RP_ID: "", REDIS_URL: "" };
    assertRequiredSecrets({ env, logger, exit });
    expect(exit).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
