import { __resetPublicStatusCacheForTests, computePublicStatus } from "./publicStatusService";

jest.mock("../db/postgres", () => ({
  checkPostgresConnection: jest.fn().mockResolvedValue(true),
  isPostgresConfigured: jest.fn().mockReturnValue(true),
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
  delete process.env.FLY_API_TOKEN;
});

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
});
