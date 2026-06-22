/**
 * HEL-810 (parent HEL-807): dispatch a queued run to an ephemeral Fly Machine
 * instead of executing it inline in the worker.
 *
 * Reuses the api image (per the HEL-807 spike): create a one-shot machine from
 * `FLY_IMAGE_REF` with `AUTOFLOW_RUN_ONCE=<runId>`, sized by the HEL-806 preset.
 * The machine boots the same image, runs that one run via executeQueuedRun (the
 * run-once gate in index.ts → runOnce.ts), writes state to Postgres exactly as
 * the inline worker does, and auto-destroys on exit.
 *
 * Opt-in per workflow (`config.isolation === true`). Returns true when a machine
 * was created (caller must NOT run inline); false to fall back to inline — when
 * the run didn't opt in, the Fly target/image is unset, or create fails.
 */

import { runStore } from "./runStore";
import { resolveMachinePreset } from "./machinePresets";
import { resolveFlyRunTarget } from "./runIsolation";
import { createFlyMachinesClient, type FlyGuest, type FlyMachinesClient } from "./flyMachinesClient";

/** Map a HEL-806 preset to a Fly guest spec. */
export function presetToGuest(preset: { vcpu: number; memoryMb: number }): FlyGuest {
  return {
    cpu_kind: preset.vcpu >= 2 ? "performance" : "shared",
    cpus: Math.max(1, Math.ceil(preset.vcpu)),
    memory_mb: preset.memoryMb,
  };
}

export async function dispatchIsolatedRun(
  runId: string,
  stepIndex = 0,
  opts: { client?: FlyMachinesClient; imageRef?: string } = {},
): Promise<boolean> {
  const run = await runStore.get(runId);
  if (!run) return false;

  const config = run.runtimeState?.config ?? {};
  // Opt-in per workflow (HEL-807 §9 rollout decision).
  if (config["isolation"] !== true) return false;

  const target = resolveFlyRunTarget();
  const image = opts.imageRef ?? process.env.FLY_IMAGE_REF;
  if (!target || !image) {
    console.warn(
      `[isolatedRun] cannot dispatch ${runId} — Fly target or FLY_IMAGE_REF unset; running inline`,
    );
    return false;
  }

  try {
    const preset = resolveMachinePreset(config);
    const client = opts.client ?? createFlyMachinesClient(target);
    const machine = await client.createMachine({
      name: `run-${runId}`,
      region: target.region,
      config: {
        image,
        env: {
          AUTOFLOW_RUN_ONCE: runId,
          AUTOFLOW_RUN_STEP_INDEX: String(stepIndex),
        },
        guest: presetToGuest(preset),
        restart: { policy: "no" },
        auto_destroy: true,
      },
    });
    console.log(`[isolatedRun] dispatched run ${runId} → machine ${machine.id} (${preset.id})`);
    return true;
  } catch (err) {
    // Create failed — don't drop the run; fall back to inline execution.
    console.error(
      `[isolatedRun] dispatch failed for ${runId}; running inline:`,
      (err as Error).message,
    );
    return false;
  }
}
