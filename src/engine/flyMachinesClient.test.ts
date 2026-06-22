import { createFlyMachinesClient, FlyMachinesError } from "./flyMachinesClient";
import type { FlyRunTarget } from "./runIsolation";

const target: FlyRunTarget = {
  token: "tok-123",
  app: "autoflow-api-dev",
  region: "ord",
  baseUrl: "https://api.machines.dev/v1",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("flyMachinesClient (HEL-809)", () => {
  it("createMachine POSTs to the app's machines endpoint with auth + config", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      return jsonResponse({ id: "m1", state: "created" });
    };
    const client = createFlyMachinesClient(target, fetchImpl);

    const machine = await client.createMachine({
      name: "run-abc",
      region: "ord",
      config: { image: "img:1", auto_destroy: true },
    });

    expect(machine).toEqual({ id: "m1", state: "created" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.machines.dev/v1/apps/autoflow-api-dev/machines");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      name: "run-abc",
      region: "ord",
      config: { image: "img:1", auto_destroy: true },
    });
  });

  it("getMachine GETs by id", async () => {
    const fetchImpl = async (url: string, _init: RequestInit): Promise<Response> => {
      expect(url).toBe("https://api.machines.dev/v1/apps/autoflow-api-dev/machines/m1");
      return jsonResponse({ id: "m1", state: "started" });
    };
    const client = createFlyMachinesClient(target, fetchImpl);
    expect((await client.getMachine("m1")).state).toBe("started");
  });

  it("listMachines GETs the machines collection", async () => {
    const fetchImpl = async (url: string, _init: RequestInit): Promise<Response> => {
      expect(url).toBe("https://api.machines.dev/v1/apps/autoflow-api-dev/machines");
      return jsonResponse([{ id: "m1", name: "run-a", state: "started" }]);
    };
    const client = createFlyMachinesClient(target, fetchImpl);
    const list = await client.listMachines();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("run-a");
  });

  it("destroyMachine DELETEs with force=true", async () => {
    let captured = "";
    const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
      captured = `${init.method} ${url}`;
      return new Response("", { status: 200 });
    };
    const client = createFlyMachinesClient(target, fetchImpl);
    await client.destroyMachine("m1");
    expect(captured).toBe(
      "DELETE https://api.machines.dev/v1/apps/autoflow-api-dev/machines/m1?force=true",
    );
  });

  it("waitForState hits the wait endpoint with state + timeout", async () => {
    const fetchImpl = async (url: string, _init: RequestInit): Promise<Response> => {
      expect(url).toContain("/machines/m1/wait?state=started&timeout=30");
      return jsonResponse({ id: "m1", state: "started" });
    };
    const client = createFlyMachinesClient(target, fetchImpl);
    expect((await client.waitForState("m1", "started", 30)).state).toBe("started");
  });

  it("maps a non-2xx response to FlyMachinesError with status + body", async () => {
    const fetchImpl = async (): Promise<Response> => new Response("nope", { status: 422 });
    const client = createFlyMachinesClient(target, fetchImpl);
    await expect(client.getMachine("m1")).rejects.toMatchObject({
      name: "FlyMachinesError",
      status: 422,
      body: "nope",
    });
    await expect(client.getMachine("m1")).rejects.toBeInstanceOf(FlyMachinesError);
  });
});
