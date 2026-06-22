import {
  getRunIsolationMode,
  resolveFlyRunTarget,
  isRunIsolationEnabled,
  __resetRunIsolationWarningForTests,
  DEFAULT_FLY_MACHINES_BASE_URL,
} from "./runIsolation";

const ENV_KEYS = [
  "RUN_ISOLATION",
  "FLY_MACHINES_TOKEN",
  "FLY_RUN_APP",
  "FLY_APP_NAME",
  "FLY_RUN_REGION",
  "FLY_REGION",
  "FLY_MACHINES_BASE_URL",
] as const;

describe("runIsolation (HEL-809)", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    __resetRunIsolationWarningForTests();
  });
  afterAll(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults to inline; only the exact flag value enables fly-machine", () => {
    expect(getRunIsolationMode()).toBe("inline");
    process.env.RUN_ISOLATION = "fly-machine";
    expect(getRunIsolationMode()).toBe("fly-machine");
    process.env.RUN_ISOLATION = "garbage";
    expect(getRunIsolationMode()).toBe("inline");
  });

  it("resolveFlyRunTarget is null until token AND app are set", () => {
    expect(resolveFlyRunTarget()).toBeNull();
    process.env.FLY_MACHINES_TOKEN = "tok";
    expect(resolveFlyRunTarget()).toBeNull(); // no app yet
    process.env.FLY_APP_NAME = "autoflow-api-dev";
    expect(resolveFlyRunTarget()).toMatchObject({
      token: "tok",
      app: "autoflow-api-dev",
      baseUrl: DEFAULT_FLY_MACHINES_BASE_URL,
    });
  });

  it("FLY_RUN_APP overrides FLY_APP_NAME and region falls back to FLY_REGION", () => {
    process.env.FLY_MACHINES_TOKEN = "tok";
    process.env.FLY_APP_NAME = "autoflow-api-dev";
    process.env.FLY_RUN_APP = "autoflow-runs";
    process.env.FLY_REGION = "ord";
    const target = resolveFlyRunTarget();
    expect(target?.app).toBe("autoflow-runs");
    expect(target?.region).toBe("ord");
  });

  it("isRunIsolationEnabled needs flag AND target; warns once when unconfigured", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(isRunIsolationEnabled()).toBe(false); // inline default

    process.env.RUN_ISOLATION = "fly-machine"; // flag on, no target
    expect(isRunIsolationEnabled()).toBe(false);
    expect(isRunIsolationEnabled()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1); // one-shot warning

    process.env.FLY_MACHINES_TOKEN = "tok";
    process.env.FLY_APP_NAME = "autoflow-api-dev";
    expect(isRunIsolationEnabled()).toBe(true);
    warn.mockRestore();
  });
});
