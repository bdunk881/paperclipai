/**
 * HEL-806 (parent HEL-698): machine-size presets + cost rate.
 *
 * trigger.dev runs each task on a sized machine (vCPU/RAM) billed per ms of
 * wall-time (`ctx.machine`). AutoFlow executes inline today, but a workflow can
 * still DECLARE a machine size via `config.machine` so (a) the run-usage roll-up
 * can bill wall-time × the preset rate now (runUsage.ts), and (b) the isolated
 * executor (HEL-807) can size the run later. This is the preset registry +
 * resolver + cost helper; nothing here changes execution.
 */

export type MachinePresetId = "small-1x" | "medium-1x" | "large-1x" | "large-2x";

export interface MachinePreset {
  id: MachinePresetId;
  vcpu: number;
  memoryMb: number;
  /** Billing rate in USD per hour of run wall-time. */
  costPerHourUsd: number;
}

export const MACHINE_PRESETS: Record<MachinePresetId, MachinePreset> = {
  "small-1x": { id: "small-1x", vcpu: 0.5, memoryMb: 512, costPerHourUsd: 0.06 },
  "medium-1x": { id: "medium-1x", vcpu: 1, memoryMb: 1024, costPerHourUsd: 0.12 },
  "large-1x": { id: "large-1x", vcpu: 2, memoryMb: 4096, costPerHourUsd: 0.24 },
  "large-2x": { id: "large-2x", vcpu: 4, memoryMb: 8192, costPerHourUsd: 0.48 },
};

export const DEFAULT_MACHINE_PRESET_ID: MachinePresetId = "small-1x";

export function isMachinePresetId(value: unknown): value is MachinePresetId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MACHINE_PRESETS, value);
}

/**
 * Resolve a run's machine preset from its config (`config.machine` or
 * `config.machinePreset`, a preset id). Unknown / absent ⇒ the default preset.
 */
export function resolveMachinePreset(config: Record<string, unknown> | undefined): MachinePreset {
  const raw = config?.["machine"] ?? config?.["machinePreset"];
  if (isMachinePresetId(raw)) return MACHINE_PRESETS[raw];
  return MACHINE_PRESETS[DEFAULT_MACHINE_PRESET_ID];
}

/** Machine cost (whole cents) for a run of `durationMs` on `preset`. */
export function machineCostCents(preset: MachinePreset, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  const hours = durationMs / 3_600_000;
  return Math.max(0, Math.round(preset.costPerHourUsd * hours * 100));
}
