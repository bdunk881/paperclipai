/**
 * Sub-workflow trigger step (HEL-677, Phase 1).
 *
 * The entry point of a workflow meant to be CALLED by another workflow (n8n's
 * Execute Sub-workflow Trigger). It declares the inputs the sub-workflow expects
 * (`config.inputs`); when a parent's `sub_workflow` step (HEL-673) runs this
 * workflow, those inputs are already seeded into the run context — this head
 * applies declared **defaults** for any the caller omitted, hoists the resolved
 * declared inputs to first-class context, and surfaces the input contract
 * (declared + missing) for visibility. Pairs with HEL-673.
 */

import type { WorkflowStep } from "../types/workflow";

export interface SubWorkflowInputDef {
  key: string;
  label: string;
  /** Optional default applied when the caller omits this input. */
  defaultValue?: unknown;
}

/** Read declared input defs from a `sub_workflow_trigger` step's `config.inputs`. */
export function parseSubWorkflowInputs(step: WorkflowStep): SubWorkflowInputDef[] {
  const config = (step.config ?? {}) as Record<string, unknown>;
  const raw = config["inputs"];
  if (!Array.isArray(raw)) return [];

  const out: SubWorkflowInputDef[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const key = typeof e["key"] === "string" ? e["key"].trim() : "";
    if (!key) continue;
    const def: SubWorkflowInputDef = {
      key,
      label: typeof e["label"] === "string" && e["label"].trim() ? e["label"] : key,
    };
    if ("defaultValue" in e) def.defaultValue = e["defaultValue"];
    out.push(def);
  }
  return out;
}

/**
 * Engine handler: resolve the declared inputs against the run context (the
 * parent's `sub_workflow` step seeds them), applying defaults for omitted ones,
 * and surface the input contract. Hoists resolved declared inputs to top-level
 * context so downstream steps can reference `{{key}}`.
 */
export function handleSubWorkflowTrigger(
  step: WorkflowStep,
  context: Record<string, unknown>,
): Record<string, unknown> {
  const defs = parseSubWorkflowInputs(step);
  const resolved: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const def of defs) {
    if (context[def.key] !== undefined) {
      resolved[def.key] = context[def.key];
    } else if (def.defaultValue !== undefined) {
      resolved[def.key] = def.defaultValue;
    } else {
      missing.push(def.key);
    }
  }

  return {
    ...resolved,
    subWorkflowTrigger: {
      declaredInputs: defs.map((d) => d.key),
      missingInputs: missing,
    },
  };
}
