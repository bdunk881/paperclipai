import { __resetPublicStatusCacheForTests, computePublicStatus } from "./publicStatusService";

const queryMock = jest.fn();
jest.mock("../db/postgres", () => ({
  checkPostgresConnection: jest.fn().mockResolvedValue(true),
  isPostgresConfigured: jest.fn().mockReturnValue(true),
  getPostgresPool: () => ({ query: queryMock }),
}));

jest.mock("../queue/redisClient", () => ({
  checkRedisConnection: jest.fn().mockResolvedValue(true),
  isRedisConfigured: jest.fn().mockReturnValue(false),
}));

jest.mock("../queue/queues", () => ({
  getDlqQueue: jest.fn().mockReturnValue(null),
  getRunQueue: jest.fn().mockReturnValue(null),
  getAgentPromptQueue: jest.fn().mockReturnValue(null),
}));

const listMachinesForApps = jest.fn();
jest.mock("../adminConsole/infra/clients/flyClient", () => ({
  listMachinesForApps: (...args: unknown[]) => listMachinesForApps(...args),
  getConfiguredFlyApps: () => ["autoflow-api-production"],
}));

beforeEach(() => {
  __resetPublicStatusCacheForTests();
  listMachinesForApps.mockReset();
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [] });
  delete process.env.FLY_API_TOKEN;
});

// Test helper: wait one microtask tick so the fire-and-forget transition
// writer inside computePublicStatus settles before assertions.
async function flushTransitionsWriter() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("computePublicStatus", () => {
  it("marks API operational when all production machines are started", async () => {
    process.env.FLY_API_TOKEN = "test";
    listMachinesForApps.mockResolvedValue([
      { appName: "autoflow-api-production", machines: [
        { id: "abc", state: "started", region: "iad" },
        { id: "def", state: "started", region: "ord" },
      ] },
    ]);
    const status = await computePublicStatus();
    expect(status.overall).toBe("operational");
    const api = status.components.find((c) => c.id === "api");
    expect(api?.level).toBe("operational");
    // Internal identifiers must not leak.
    expect(JSON.stringify(status)).not.toContain("abc");
    expect(JSON.stringify(status)).not.toContain("autoflow-api-production");
  });

  it("marks API degraded when some machines are not started", async () => {
    process.env.FLY_API_TOKEN = "test";
    listMachinesForApps.mockResolvedValue([
      { appName: "autoflow-api-production", machines: [
        { id: "abc", state: "started", region: "iad" },
        { id: "def", state: "stopped", region: "ord" },
      ] },
    ]);
    const status = await computePublicStatus();
    expect(status.overall).toBe("degraded");
    const api = status.components.find((c) => c.id === "api");
    expect(api?.level).toBe("degraded");
    expect(api?.message).toContain("1/2");
  });

  it("marks API down when machines list is empty", async () => {
    process.env.FLY_API_TOKEN = "test";
    listMachinesForApps.mockResolvedValue([
      { appName: "autoflow-api-production", machines: [] },
    ]);
    const status = await computePublicStatus();
    expect(status.overall).toBe("down");
    const api = status.components.find((c) => c.id === "api");
    expect(api?.level).toBe("down");
  });

  it("renders unknown level when FLY_API_TOKEN is unset", async () => {
    const status = await computePublicStatus();
    const api = status.components.find((c) => c.id === "api");
    expect(api?.level).toBe("unknown");
  });

  it("caches across calls within 30s", async () => {
    process.env.FLY_API_TOKEN = "test";
    listMachinesForApps.mockResolvedValue([
      { appName: "autoflow-api-production", machines: [
        { id: "abc", state: "started", region: "iad" },
      ] },
    ]);
    await computePublicStatus();
    await computePublicStatus();
    expect(listMachinesForApps).toHaveBeenCalledTimes(1);
  });

  it("records a transition row when a component flips level", async () => {
    process.env.FLY_API_TOKEN = "test";
    // First snapshot: all up.
    listMachinesForApps.mockResolvedValueOnce([
      { appName: "autoflow-api-production", machines: [
        { id: "abc", state: "started", region: "iad" },
      ] },
    ]);
    await computePublicStatus(1000);
    await flushTransitionsWriter();
    // First observation should NOT write — the cold-start contract is
    // "establish baseline silently."
    const firstInserts = queryMock.mock.calls.filter((c) =>
      String(c[0]).includes("INSERT INTO public_status_events"),
    );
    expect(firstInserts).toHaveLength(0);

    // Second snapshot: machine stopped → component flips to down.
    listMachinesForApps.mockResolvedValueOnce([
      { appName: "autoflow-api-production", machines: [
        { id: "abc", state: "stopped", region: "iad" },
      ] },
    ]);
    await computePublicStatus(60_000);
    await flushTransitionsWriter();

    const inserts = queryMock.mock.calls.filter((c) =>
      String(c[0]).includes("INSERT INTO public_status_events"),
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toEqual(["api", "Core API", "down", null]);
  });

  it("does not write transitions when the level stays the same", async () => {
    process.env.FLY_API_TOKEN = "test";
    const machines = [{ id: "abc", state: "started", region: "iad" }];
    listMachinesForApps.mockResolvedValue([
      { appName: "autoflow-api-production", machines },
    ]);
    await computePublicStatus(1000);
    await computePublicStatus(60_000);
    await flushTransitionsWriter();
    const inserts = queryMock.mock.calls.filter((c) =>
      String(c[0]).includes("INSERT INTO public_status_events"),
    );
    expect(inserts).toHaveLength(0);
  });
});
