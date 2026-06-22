/**
 * HEL-811 (parent HEL-807): reaper for ephemeral isolated run-machines.
 *
 * Sibling of strandedRunReaper — an advisory-locked periodic sweep (fleet-safe).
 * For each `run-<runId>` machine on the Fly app:
 *   - run row gone           → destroy (orphan).
 *   - run terminal           → destroy (belt-and-suspenders to auto_destroy).
 *   - machine age > maxDuration + grace → **force-kill + fail the run** (the
 *     true mid-step kill the HEL-805 in-process race couldn't do; normally the
 *     in-process cap stops the run first, so this only fires for a wedged VM).
 *
 * No-op unless run isolation is enabled (RUN_ISOLATION=fly-machine + a target).
 */

import { runStore } from "./runStore";
import { resolveMaxDurationMs } from "./runMaxDuration";
import { isRunIsolationEnabled, resolveFlyRunTarget } from "./runIsolation";
import {
  createFlyMachinesClient,
  type FlyMachine,
  type FlyMachinesClient,
} from "./flyMachinesClient";
import { runWithAdvisoryLock, CoordinatorLockKey } from "./coordinatorLock";

const TERMINAL = new Set(["completed", "failed", "canceled", "cancelled"]);
const MACHINE_NAME_PREFIX = "run-";

export const DEFAULT_RUN_MACHINE_REAPER_INTERVAL_MS = 60_000;
/** Grace beyond maxDuration before force-killing — the in-process cap should
 *  stop a healthy run first; this only catches a wedged VM. */
export const DEFAULT_RUN_MACHINE_KILL_GRACE_MS = 60_000;

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

export interface RunMachineReaperResult {
  scanned: number;
  destroyed: number;
  killed: number;
}

async function tryDestroy(client: FlyMachinesClient, id: string): Promise<boolean> {
  try {
    await client.destroyMachine(id);
    return true;
  } catch (err) {
    console.warn(`[runMachineReaper] destroy ${id} failed:`, (err as Error).message);
    return false;
  }
}

export async function runMachineReaperSweep(
  now: number = Date.now(),
  deps: { client?: FlyMachinesClient } = {},
): Promise<RunMachineReaperResult> {
  let result: RunMachineReaperResult = { scanned: 0, destroyed: 0, killed: 0 };
  if (!isRunIsolationEnabled()) return result;
  const target = resolveFlyRunTarget();
  if (!target) return result;

  await runWithAdvisoryLock(CoordinatorLockKey.runMachineReaper, async () => {
    const client = deps.client ?? createFlyMachinesClient(target);

    let machines: FlyMachine[];
    try {
      machines = await client.listMachines();
    } catch (err) {
      console.warn("[runMachineReaper] list failed:", (err as Error).message);
      return;
    }

    const runMachines = machines.filter((m) => m.name?.startsWith(MACHINE_NAME_PREFIX));
    const grace = envInt("RUN_MACHINE_KILL_GRACE_MS", DEFAULT_RUN_MACHINE_KILL_GRACE_MS);
    let destroyed = 0;
    let killed = 0;

    for (const m of runMachines) {
      const runId = m.name!.slice(MACHINE_NAME_PREFIX.length);
      const run = await runStore.get(runId).catch(() => undefined);

      // Orphan or terminal run → just destroy the machine.
      if (!run || TERMINAL.has(run.status)) {
        if (await tryDestroy(client, m.id)) destroyed += 1;
        continue;
      }

      // Wedged past the budget → force-kill + fail the run (true maxDuration
      // kill). Uses the machine's own age; skips if the timestamp is unusable
      // (conservative — never kill on bad data).
      const createdMs = m.created_at ? Date.parse(m.created_at) : Number.NaN;
      if (!Number.isFinite(createdMs)) continue;
      const maxDurationMs = resolveMaxDurationMs(run.runtimeState?.config);
      if (now - createdMs <= maxDurationMs + grace) continue;

      if (await tryDestroy(client, m.id)) {
        await runStore.update(runId, {
          status: "failed",
          completedAt: new Date(now).toISOString(),
          error: `Run exceeded its max duration of ${maxDurationMs}ms (machine killed)`,
        });
        killed += 1;
      }
    }

    result = { scanned: runMachines.length, destroyed, killed };
    if (destroyed > 0 || killed > 0) {
      console.log(
        `[runMachineReaper] swept ${result.scanned} run-machines — destroyed ${destroyed}, killed ${killed}`,
      );
    }
  });

  return result;
}

let reaperTimer: ReturnType<typeof setInterval> | undefined;

export function startRunMachineReaper(
  intervalMs = envInt("RUN_MACHINE_REAPER_INTERVAL_MS", DEFAULT_RUN_MACHINE_REAPER_INTERVAL_MS),
): void {
  if (reaperTimer) return;
  reaperTimer = setInterval(() => {
    void runMachineReaperSweep().catch((err) =>
      console.error("[runMachineReaper] sweep failed", err),
    );
  }, intervalMs);
  reaperTimer.unref?.();
}

export function stopRunMachineReaper(): void {
  if (!reaperTimer) return;
  clearInterval(reaperTimer);
  reaperTimer = undefined;
}
