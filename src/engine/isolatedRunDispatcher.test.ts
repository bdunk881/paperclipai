import { dispatchIsolatedRun, presetToGuest } from "./isolatedRunDispatcher";
import { runStore } from "./runStore";
import type { FlyMachinesClient } from "./flyMachinesClient";

const ENV = [
  "FLY_MACHINES_TOKEN",
  "FLY_APP_NAME",
  "FLY_RUN_APP",
  "FLY_REGION",
  "FLY_RUN_REGION",
  "FLY_IMAGE_REF",
] as const;

function mockClient(overrides: Partial<FlyMachinesClient> = {}): FlyMachinesClient {
  return {
    createMachine: jest.fn(async () => ({ id: "m-1", state: "created" })),
    getMachine: jest.fn(async () => ({ id: "m-1", state: "started" })),
    destroyMachine: jest.fn(async () => undefined),
    waitForState: jest.fn(async () => ({ id: "m-1", state: "started" })),
    ...overrides,
  };
}

async function makeRun(id: string, config: Record<string, unknown>): Promise<void> {
  await runStore.create({
    id,
    templateId: "tpl",
    templateName: "T",
    status: "queued",
    startedAt: new Date().toISOString(),
    input: {},
    stepResults: [],
    runtimeState: { config, context: {}, currentStepIndex: 0 },
  });
}

describe("isolatedRunDispatcher (HEL-810)", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(async () => {
    await runStore.clear();
    for (const k of ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("presetToGuest maps vcpu/memory to a Fly guest", () => {
    expect(presetToGuest({ vcpu: 0.5, memoryMb: 512 })).toEqual({
      cpu_kind: "shared",
      cpus: 1,
      memory_mb: 512,
    });
    expect(presetToGuest({ vcpu: 2, memoryMb: 4096 })).toEqual({
      cpu_kind: "performance",
      cpus: 2,
      memory_mb: 4096,
    });
  });

  it("declines (false) when the run did not opt in", async () => {
    await makeRun("r1", {}); // no isolation flag
    const client = mockClient();
    expect(await dispatchIsolatedRun("r1", 0, { client })).toBe(false);
    expect(client.createMachine).not.toHaveBeenCalled();
  });

  it("declines (false) when the Fly target / image is unset", async () => {
    await makeRun("r2", { isolation: true });
    const client = mockClient();
    expect(await dispatchIsolatedRun("r2", 0, { client, imageRef: "img:1" })).toBe(false); // no token/app
    expect(client.createMachine).not.toHaveBeenCalled();
  });

  it("creates an isolated machine when opted in + configured", async () => {
    process.env.FLY_MACHINES_TOKEN = "tok";
    process.env.FLY_APP_NAME = "autoflow-api-dev";
    process.env.FLY_IMAGE_REF = "registry/autoflow-api:deployment-x";
    await makeRun("r3", { isolation: true, machine: "medium-1x" });
    const create = jest.fn(async () => ({ id: "m-3", state: "created" }));
    const client = mockClient({ createMachine: create });

    expect(await dispatchIsolatedRun("r3", 2, { client })).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "run-r3",
        config: expect.objectContaining({
          image: "registry/autoflow-api:deployment-x",
          env: { AUTOFLOW_RUN_ONCE: "r3", AUTOFLOW_RUN_STEP_INDEX: "2" },
          guest: { cpu_kind: "shared", cpus: 1, memory_mb: 1024 }, // medium-1x
          restart: { policy: "no" },
          auto_destroy: true,
        }),
      }),
    );
  });

  it("falls back (false) when machine create throws", async () => {
    process.env.FLY_MACHINES_TOKEN = "tok";
    process.env.FLY_APP_NAME = "autoflow-api-dev";
    process.env.FLY_IMAGE_REF = "img:1";
    await makeRun("r4", { isolation: true });
    const client = mockClient({
      createMachine: jest.fn(async () => {
        throw new Error("fly 500");
      }),
    });
    expect(await dispatchIsolatedRun("r4", 0, { client })).toBe(false);
  });
});
