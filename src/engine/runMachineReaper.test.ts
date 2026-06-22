import {
  runMachineReaperSweep,
  startRunMachineReaper,
  stopRunMachineReaper,
} from "./runMachineReaper";
import { runStore } from "./runStore";
import { __resetRunIsolationWarningForTests } from "./runIsolation";
import type { FlyMachine, FlyMachinesClient } from "./flyMachinesClient";
import type { WorkflowRun } from "../types/workflow";

const ENV = [
  "RUN_ISOLATION",
  "FLY_MACHINES_TOKEN",
  "FLY_APP_NAME",
  "FLY_RUN_APP",
  "FLY_REGION",
  "FLY_RUN_REGION",
  "RUN_MACHINE_KILL_GRACE_MS",
] as const;

function mockClient(
  machines: FlyMachine[],
  destroyMachine = jest.fn(async () => undefined),
): FlyMachinesClient {
  return {
    createMachine: jest.fn(),
    getMachine: jest.fn(),
    listMachines: jest.fn(async () => machines),
    destroyMachine,
    waitForState: jest.fn(),
  } as unknown as FlyMachinesClient;
}

async function makeRun(
  id: string,
  status: WorkflowRun["status"],
  config: Record<string, unknown> = {},
): Promise<void> {
  await runStore.create({
    id,
    templateId: "tpl",
    templateName: "T",
    status,
    startedAt: new Date().toISOString(),
    input: {},
    stepResults: [],
    runtimeState: { config, context: {}, currentStepIndex: 0 },
  });
}

describe("runMachineReaper (HEL-811)", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(async () => {
    await runStore.clear();
    for (const k of ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    __resetRunIsolationWarningForTests();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    // Enable isolation for the sweep (overridden in the disabled-case test).
    process.env.RUN_ISOLATION = "fly-machine";
    process.env.FLY_MACHINES_TOKEN = "tok";
    process.env.FLY_APP_NAME = "autoflow-api-dev";
  });
  afterEach(() => {
    stopRunMachineReaper();
    jest.restoreAllMocks();
  });
  afterAll(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("no-ops when isolation is disabled", async () => {
    process.env.RUN_ISOLATION = "inline";
    const client = mockClient([{ id: "m1", name: "run-r1", state: "started" }]);
    expect(await runMachineReaperSweep(Date.now(), { client })).toEqual({
      scanned: 0,
      destroyed: 0,
      killed: 0,
    });
    expect(client.listMachines).not.toHaveBeenCalled();
  });

  it("ignores machines not named run-*", async () => {
    const destroy = jest.fn(async () => undefined);
    const client = mockClient(
      [
        { id: "a", name: "autoflow-api-dev", state: "started" },
        { id: "w", name: "worker", state: "started" },
      ],
      destroy,
    );
    expect((await runMachineReaperSweep(Date.now(), { client })).scanned).toBe(0);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("destroys an orphan machine (no run row)", async () => {
    const destroy = jest.fn(async () => undefined);
    const client = mockClient([{ id: "m1", name: "run-gone", state: "stopped" }], destroy);
    expect(await runMachineReaperSweep(Date.now(), { client })).toMatchObject({
      scanned: 1,
      destroyed: 1,
      killed: 0,
    });
    expect(destroy).toHaveBeenCalledWith("m1");
  });

  it("destroys a machine whose run is terminal", async () => {
    await makeRun("r2", "completed");
    const destroy = jest.fn(async () => undefined);
    const client = mockClient([{ id: "m2", name: "run-r2", state: "stopped" }], destroy);
    expect((await runMachineReaperSweep(Date.now(), { client })).destroyed).toBe(1);
    expect(destroy).toHaveBeenCalledWith("m2");
  });

  it("force-kills + fails a run whose machine outlived maxDuration + grace", async () => {
    process.env.RUN_MACHINE_KILL_GRACE_MS = "1000";
    await makeRun("r3", "running", { maxDurationMs: 60_000 });
    const createdMs = 1_000_000;
    const now = createdMs + 60_000 + 1000 + 1; // past budget + grace
    const destroy = jest.fn(async () => undefined);
    const client = mockClient(
      [{ id: "m3", name: "run-r3", state: "started", created_at: new Date(createdMs).toISOString() }],
      destroy,
    );

    expect((await runMachineReaperSweep(now, { client })).killed).toBe(1);
    expect(destroy).toHaveBeenCalledWith("m3");
    const run = await runStore.get("r3");
    expect(run?.status).toBe("failed");
    expect(run?.error ?? "").toMatch(/max duration/i);
  });

  it("leaves a within-budget running machine alone", async () => {
    await makeRun("r4", "running", { maxDurationMs: 60_000 });
    const createdMs = 2_000_000;
    const destroy = jest.fn(async () => undefined);
    const client = mockClient(
      [{ id: "m4", name: "run-r4", state: "started", created_at: new Date(createdMs).toISOString() }],
      destroy,
    );

    expect(await runMachineReaperSweep(createdMs + 10_000, { client })).toMatchObject({
      scanned: 1,
      destroyed: 0,
      killed: 0,
    });
    expect(destroy).not.toHaveBeenCalled();
    expect((await runStore.get("r4"))?.status).toBe("running");
  });

  it("start/stop manage a single interval", () => {
    jest.useFakeTimers();
    const setI = jest.spyOn(global, "setInterval");
    const clearI = jest.spyOn(global, "clearInterval");
    startRunMachineReaper(1000);
    startRunMachineReaper(1000);
    expect(setI).toHaveBeenCalledTimes(1);
    stopRunMachineReaper();
    stopRunMachineReaper();
    expect(clearI).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
