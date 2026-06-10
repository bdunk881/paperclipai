/**
 * HEL-677: sub-workflow trigger — pure helper unit tests (input-def parse,
 * default application, missing-flagging, no-op shape).
 */

import { parseSubWorkflowInputs, handleSubWorkflowTrigger } from "./subWorkflowTriggerStep";
import type { WorkflowStep } from "../types/workflow";

function makeStep(config: Record<string, unknown> = {}): WorkflowStep {
  return {
    id: "swt",
    name: "swt",
    kind: "sub_workflow_trigger",
    description: "",
    inputKeys: [],
    outputKeys: [],
    config,
  };
}

describe("parseSubWorkflowInputs (HEL-677)", () => {
  it("normalises declared input defs and drops invalid entries", () => {
    const defs = parseSubWorkflowInputs(
      makeStep({
        inputs: [
          { key: "leadId", label: "Lead ID" },
          { key: "tier", defaultValue: "free" },
          { label: "no key" },
          "nope",
        ],
      }),
    );
    expect(defs).toEqual([
      { key: "leadId", label: "Lead ID" },
      { key: "tier", label: "tier", defaultValue: "free" },
    ]);
  });

  it("returns [] when there are no declared inputs", () => {
    expect(parseSubWorkflowInputs(makeStep({}))).toEqual([]);
  });
});

describe("handleSubWorkflowTrigger (HEL-677)", () => {
  it("hoists passed inputs and applies defaults for omitted ones", () => {
    const out = handleSubWorkflowTrigger(
      makeStep({ inputs: [{ key: "leadId" }, { key: "tier", defaultValue: "free" }] }),
      { leadId: "L1" },
    );
    expect(out).toMatchObject({ leadId: "L1", tier: "free" });
    expect(out.subWorkflowTrigger).toEqual({
      declaredInputs: ["leadId", "tier"],
      missingInputs: [],
    });
  });

  it("flags declared inputs that are missing with no default", () => {
    const out = handleSubWorkflowTrigger(makeStep({ inputs: [{ key: "required1" }] }), {});
    expect((out.subWorkflowTrigger as { missingInputs: string[] }).missingInputs).toEqual([
      "required1",
    ]);
  });

  it("is a safe no-op shape with no declared inputs", () => {
    expect(handleSubWorkflowTrigger(makeStep({}), {})).toEqual({
      subWorkflowTrigger: { declaredInputs: [], missingInputs: [] },
    });
  });
});
