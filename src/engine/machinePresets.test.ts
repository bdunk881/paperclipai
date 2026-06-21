import {
  MACHINE_PRESETS,
  DEFAULT_MACHINE_PRESET_ID,
  isMachinePresetId,
  resolveMachinePreset,
  machineCostCents,
} from "./machinePresets";

describe("machinePresets (HEL-806)", () => {
  it("isMachinePresetId recognizes known ids only", () => {
    expect(isMachinePresetId("medium-1x")).toBe(true);
    expect(isMachinePresetId("nope")).toBe(false);
    expect(isMachinePresetId(undefined)).toBe(false);
    expect(isMachinePresetId(42)).toBe(false);
  });

  it("resolveMachinePreset reads config.machine / config.machinePreset", () => {
    expect(resolveMachinePreset({ machine: "large-1x" }).id).toBe("large-1x");
    expect(resolveMachinePreset({ machinePreset: "large-2x" }).id).toBe("large-2x");
  });

  it("resolveMachinePreset defaults on unknown / absent config", () => {
    expect(resolveMachinePreset({ machine: "bogus" }).id).toBe(DEFAULT_MACHINE_PRESET_ID);
    expect(resolveMachinePreset({}).id).toBe(DEFAULT_MACHINE_PRESET_ID);
    expect(resolveMachinePreset(undefined).id).toBe(DEFAULT_MACHINE_PRESET_ID);
  });

  it("machineCostCents = rate × hours, rounded to whole cents", () => {
    expect(machineCostCents(MACHINE_PRESETS["medium-1x"], 3_600_000)).toBe(12); // $0.12/hr × 1h
    expect(machineCostCents(MACHINE_PRESETS["small-1x"], 1_800_000)).toBe(3); // $0.06/hr × 0.5h
    expect(machineCostCents(MACHINE_PRESETS["small-1x"], 0)).toBe(0);
    expect(machineCostCents(MACHINE_PRESETS["small-1x"], -5)).toBe(0);
    expect(machineCostCents(MACHINE_PRESETS["small-1x"], 5_000)).toBe(0); // sub-cent → 0
  });
});
