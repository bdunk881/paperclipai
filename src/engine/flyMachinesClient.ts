/**
 * HEL-809 (parent HEL-807): a thin typed client for the Fly Machines API
 * (https://fly.io/docs/machines/api/) — just the verbs the run-isolation
 * dispatcher (HEL-810) + reaper (HEL-811) need: create / get / destroy / wait.
 *
 * `fetchImpl` is injectable so tests run without network. Build one from a
 * resolved target: `createFlyMachinesClient(resolveFlyRunTarget()!)`.
 */

import type { FlyRunTarget } from "./runIsolation";

export interface FlyGuest {
  cpu_kind: "shared" | "performance";
  cpus: number;
  memory_mb: number;
}

export interface FlyMachineConfig {
  image: string;
  env?: Record<string, string>;
  guest?: FlyGuest;
  restart?: { policy: "no" | "always" | "on-failure" };
  auto_destroy?: boolean;
}

export interface FlyMachine {
  id: string;
  name?: string;
  state: string;
  region?: string;
  instance_id?: string;
}

export class FlyMachinesError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "FlyMachinesError";
  }
}

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export interface FlyMachinesClient {
  createMachine(args: {
    name?: string;
    region?: string;
    config: FlyMachineConfig;
  }): Promise<FlyMachine>;
  getMachine(id: string): Promise<FlyMachine>;
  destroyMachine(id: string, force?: boolean): Promise<void>;
  waitForState(id: string, state: string, timeoutSec?: number): Promise<FlyMachine>;
}

export function createFlyMachinesClient(
  target: FlyRunTarget,
  fetchImpl: FetchImpl = fetch,
): FlyMachinesClient {
  const base = `${target.baseUrl.replace(/\/$/, "")}/apps/${encodeURIComponent(target.app)}/machines`;
  const authHeaders = {
    Authorization: `Bearer ${target.token}`,
    "Content-Type": "application/json",
  };

  async function call(path: string, init: RequestInit): Promise<Response> {
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { ...authHeaders, ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new FlyMachinesError(
        `Fly Machines ${init.method ?? "GET"} ${path} failed: ${res.status}`,
        res.status,
        body,
      );
    }
    return res;
  }

  return {
    async createMachine({ name, region, config }) {
      const res = await call("", {
        method: "POST",
        body: JSON.stringify({
          ...(name ? { name } : {}),
          ...(region ? { region } : {}),
          config,
        }),
      });
      return (await res.json()) as FlyMachine;
    },
    async getMachine(id) {
      const res = await call(`/${encodeURIComponent(id)}`, { method: "GET" });
      return (await res.json()) as FlyMachine;
    },
    async destroyMachine(id, force = true) {
      await call(`/${encodeURIComponent(id)}?force=${force ? "true" : "false"}`, {
        method: "DELETE",
      });
    },
    async waitForState(id, state, timeoutSec = 60) {
      const res = await call(
        `/${encodeURIComponent(id)}/wait?state=${encodeURIComponent(state)}&timeout=${timeoutSec}`,
        { method: "GET" },
      );
      return (await res.json()) as FlyMachine;
    },
  };
}
