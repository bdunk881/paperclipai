import {
  QA_BYPASS_FLAGS,
  assertProductionSafety,
  isProductionEnvironment,
  isQaBypassActive,
  isQaBypassEnabledByName,
  listActiveBypassFlags,
} from "./qaBypassGuard";

const AUTH_FLAG = QA_BYPASS_FLAGS.find((f) => f.envVar === "QA_AUTH_BYPASS_ENABLED")!;
const PREVIEW_FLAG = QA_BYPASS_FLAGS.find(
  (f) => f.envVar === "QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW",
)!;

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) base[key] = value;
  }
  return base;
}

describe("qaBypassGuard inventory", () => {
  it("includes both known QA bypass flags so the production-boot guard sees them", () => {
    expect(AUTH_FLAG).toBeDefined();
    expect(PREVIEW_FLAG).toBeDefined();
  });
});

describe("isProductionEnvironment", () => {
  it("treats NODE_ENV=production as production", () => {
    expect(isProductionEnvironment(envWith({ NODE_ENV: "production" }))).toBe(true);
  });

  it("treats missing NODE_ENV as production (fail closed)", () => {
    expect(isProductionEnvironment(envWith({}))).toBe(true);
  });

  it("trims and lowercases the value", () => {
    expect(isProductionEnvironment(envWith({ NODE_ENV: "  Production " }))).toBe(true);
  });

  it("treats explicit non-production envs as non-production", () => {
    expect(isProductionEnvironment(envWith({ NODE_ENV: "development" }))).toBe(false);
    expect(isProductionEnvironment(envWith({ NODE_ENV: "test" }))).toBe(false);
    expect(isProductionEnvironment(envWith({ NODE_ENV: "staging" }))).toBe(false);
  });
});

describe("isQaBypassActive / isQaBypassEnabledByName", () => {
  const original = process.env;

  afterEach(() => {
    process.env = original;
  });

  it("returns false when NODE_ENV is production even if the flag is true", () => {
    process.env = { ...original, NODE_ENV: "production", QA_AUTH_BYPASS_ENABLED: "true" };
    expect(isQaBypassActive(AUTH_FLAG)).toBe(false);
    expect(isQaBypassEnabledByName("QA_AUTH_BYPASS_ENABLED")).toBe(false);
  });

  it("returns true outside production when the flag is exactly 'true'", () => {
    process.env = { ...original, NODE_ENV: "test", QA_AUTH_BYPASS_ENABLED: "true" };
    expect(isQaBypassActive(AUTH_FLAG)).toBe(true);
    expect(isQaBypassEnabledByName("QA_AUTH_BYPASS_ENABLED")).toBe(true);
  });

  it("returns false outside production when the flag is any other value", () => {
    for (const value of ["1", "yes", "TRUE", "", undefined]) {
      process.env = { ...original, NODE_ENV: "test" };
      if (value !== undefined) process.env.QA_AUTH_BYPASS_ENABLED = value;
      expect(isQaBypassActive(AUTH_FLAG)).toBe(false);
    }
  });

  it("returns false for unknown flag names", () => {
    process.env = { ...original, NODE_ENV: "test" };
    expect(isQaBypassEnabledByName("NOT_A_REAL_FLAG")).toBe(false);
  });
});

describe("listActiveBypassFlags", () => {
  it("ignores NODE_ENV and just enumerates whatever is set", () => {
    const env = envWith({
      NODE_ENV: "production",
      QA_AUTH_BYPASS_ENABLED: "true",
      QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW: "false",
    });
    const active = listActiveBypassFlags(env);
    expect(active.map((f) => f.envVar)).toEqual(["QA_AUTH_BYPASS_ENABLED"]);
  });
});

describe("assertProductionSafety", () => {
  it("does nothing in non-production environments even when flags are set", () => {
    const env = envWith({
      NODE_ENV: "development",
      QA_AUTH_BYPASS_ENABLED: "true",
      QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW: "true",
    });
    expect(() => assertProductionSafety(env)).not.toThrow();
  });

  it("does nothing in production when no flag is asserted", () => {
    expect(() => assertProductionSafety(envWith({ NODE_ENV: "production" }))).not.toThrow();
  });

  it("refuses to boot in production when QA_AUTH_BYPASS_ENABLED is set", () => {
    const env = envWith({ NODE_ENV: "production", QA_AUTH_BYPASS_ENABLED: "true" });
    expect(() => assertProductionSafety(env)).toThrow(/QA_AUTH_BYPASS_ENABLED/);
  });

  it("refuses to boot in production when QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW is set", () => {
    const env = envWith({
      NODE_ENV: "production",
      QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW: "true",
    });
    expect(() => assertProductionSafety(env)).toThrow(/QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW/);
  });

  it("refuses to boot when NODE_ENV is missing entirely (fail closed) and any flag is set", () => {
    const env = envWith({ QA_AUTH_BYPASS_ENABLED: "true" });
    expect(() => assertProductionSafety(env)).toThrow(/Refusing to boot/);
  });

  it("lists every active flag in the error message so the operator sees the full set", () => {
    const env = envWith({
      NODE_ENV: "production",
      QA_AUTH_BYPASS_ENABLED: "true",
      QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW: "true",
    });
    let caught: Error | null = null;
    try {
      assertProductionSafety(env);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/QA_AUTH_BYPASS_ENABLED/);
    expect(caught!.message).toMatch(/QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW/);
  });
});
