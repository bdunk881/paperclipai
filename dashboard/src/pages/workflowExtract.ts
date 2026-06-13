/**
 * Extract-to-sub-workflow surgery (HEL-778, Phase 1) — pure, unit-tested.
 *
 * Given a workflow template and a set of selected step ids, compute (a) a new
 * CHILD template containing the selected steps behind a `sub_workflow_trigger`
 * head, and (b) the rewired PARENT template where the selection is replaced by a
 * single `sub_workflow` step that calls the child. The caller creates the child
 * via `createCanonicalWorkflow` (to get its id), then applies the parent.
 *
 * The canvas edge model is per-step adjacency in `config[STEP_NEXT_IDS_KEY]`
 * (see workflowGraph.ts). The child inherits the parent's run context by default
 * (no `config.input` on the sub_workflow step → `resolveSubWorkflowInput` passes
 * the parent context through), so `{{key}}` references in the extracted steps
 * keep resolving and the child's output merges back into the parent run.
 *
 * v1 contract: the selection must form a single-entry / single-exit run — at
 * most one step targeted from outside and at most one outside target — so the
 * replacement `sub_workflow` step slots cleanly into one in-edge and one
 * out-edge. Triggers can't be extracted. Anything else is rejected with a
 * human-readable reason (no partial mutation).
 */
import {
  buildEdgesFromSteps,
  serializeEdgesToSteps,
  STEP_NEXT_IDS_KEY,
  STEP_POSITION_KEY,
} from "./workflowGraph";
import type { StepKind, WorkflowStep, WorkflowTemplate } from "../types/workflow";

const TRIGGER_KINDS: ReadonlySet<StepKind> = new Set<StepKind>([
  "trigger",
  "cron_trigger",
  "interval_trigger",
  "file_trigger",
  "form_trigger",
  "error_trigger",
  "chat_trigger",
  "sub_workflow_trigger",
]);

function getNextIds(step: WorkflowStep): string[] {
  const value = step.config?.[STEP_NEXT_IDS_KEY];
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function setNextIds(step: WorkflowStep, ids: string[]): WorkflowStep {
  return { ...step, config: { ...(step.config ?? {}), [STEP_NEXT_IDS_KEY]: ids } };
}

export interface ExtractSelectionInput {
  template: WorkflowTemplate;
  selectedIds: string[];
  /** The new saved workflow's id (from createCanonicalWorkflow). */
  childWorkflowId: string;
  childName: string;
  /** Fresh id for the replacement `sub_workflow` step in the parent. */
  subWorkflowStepId: string;
  /** Fresh id for the child's `sub_workflow_trigger` head. */
  childTriggerId: string;
}

export type ExtractSelectionResult =
  | { ok: true; child: WorkflowTemplate; parent: WorkflowTemplate }
  | { ok: false; reason: string };

export function extractSelection(input: ExtractSelectionInput): ExtractSelectionResult {
  const { selectedIds, childWorkflowId, childName, subWorkflowStepId, childTriggerId } = input;

  // Normalize the edge model to explicit per-step adjacency first. A freshly
  // loaded or imported template may carry NO `config[STEP_NEXT_IDS_KEY]` and rely
  // on implicit linear order (buildEdgesFromSteps' fallback); serializing the
  // built edges back makes the adjacency explicit so the surgery below is exact.
  const template: WorkflowTemplate = {
    ...input.template,
    steps: serializeEdgesToSteps(input.template.steps, buildEdgesFromSteps(input.template.steps)),
  };

  const sel = new Set(selectedIds);
  if (sel.size === 0) return { ok: false, reason: "Select at least one step to extract." };

  const byId = new Map(template.steps.map((s) => [s.id, s]));
  for (const id of sel) {
    if (!byId.has(id)) return { ok: false, reason: "A selected step no longer exists." };
  }

  const selectedSteps = template.steps.filter((s) => sel.has(s.id));
  if (selectedSteps.some((s) => TRIGGER_KINDS.has(s.kind))) {
    return {
      ok: false,
      reason: "Triggers can't move into a sub-workflow — deselect the start step.",
    };
  }

  // Boundary detection over the adjacency model.
  const entrySteps = new Set<string>(); // selected steps targeted from OUTSIDE the selection
  const exitTargets = new Set<string>(); // OUTSIDE steps targeted from a selected step
  for (const step of template.steps) {
    const targets = getNextIds(step);
    if (sel.has(step.id)) {
      for (const t of targets) if (!sel.has(t)) exitTargets.add(t);
    } else {
      for (const t of targets) if (sel.has(t)) entrySteps.add(t);
    }
  }

  if (entrySteps.size > 1) {
    return {
      ok: false,
      reason: "Those steps have more than one entry point — pick a single connected run.",
    };
  }
  if (exitTargets.size > 1) {
    return {
      ok: false,
      reason: "Those steps have more than one exit point — pick a single connected run.",
    };
  }

  // The entry step is the one targeted from outside; if the selection sits at the
  // graph start (no external in-edge), it's the single selected step that no
  // other selected step points to.
  let entryStepId: string | undefined =
    entrySteps.size === 1 ? [...entrySteps][0] : undefined;
  if (!entryStepId) {
    const targetedWithin = new Set<string>();
    for (const s of selectedSteps) {
      for (const t of getNextIds(s)) if (sel.has(t)) targetedWithin.add(t);
    }
    const roots = selectedSteps.filter((s) => !targetedWithin.has(s.id));
    if (roots.length !== 1) {
      return {
        ok: false,
        reason: "Couldn't find a single entry step — pick a single connected run.",
      };
    }
    entryStepId = roots[0].id;
  }
  const exitTargetId: string | null = exitTargets.size === 1 ? [...exitTargets][0] : null;

  const entryStep = byId.get(entryStepId);
  if (!entryStep) return { ok: false, reason: "Couldn't resolve the entry step." };

  // --- Child template: a sub_workflow_trigger head → the selected steps, with
  // their internal edges preserved and any out-of-selection edges dropped. ---
  const childTrigger: WorkflowStep = {
    id: childTriggerId,
    name: "Called as sub-workflow",
    kind: "sub_workflow_trigger",
    description: "",
    inputKeys: [],
    outputKeys: [],
    config: {
      [STEP_POSITION_KEY]: { x: 0, y: 0 },
      [STEP_NEXT_IDS_KEY]: [entryStepId],
    },
  };
  const childSelected = selectedSteps.map((s) =>
    setNextIds(
      s,
      getNextIds(s).filter((t) => sel.has(t)),
    ),
  );
  const child: WorkflowTemplate = {
    ...template,
    id: childWorkflowId,
    name: childName,
    description: `Extracted from ${template.name}`,
    steps: [childTrigger, ...childSelected],
  };

  // --- Parent: drop the selected steps, insert one sub_workflow step where the
  // entry step was, rewire external in-edges to it, and carry the single exit. ---
  const entryPosition = entryStep.config?.[STEP_POSITION_KEY];
  const subWorkflowStep: WorkflowStep = {
    id: subWorkflowStepId,
    name: childName,
    kind: "sub_workflow",
    description: "",
    inputKeys: [],
    outputKeys: [],
    config: {
      workflowId: childWorkflowId,
      [STEP_POSITION_KEY]:
        entryPosition && typeof entryPosition === "object" ? entryPosition : { x: 0, y: 0 },
      [STEP_NEXT_IDS_KEY]: exitTargetId ? [exitTargetId] : [],
    },
  };

  const parentSteps: WorkflowStep[] = [];
  let inserted = false;
  for (const step of template.steps) {
    if (sel.has(step.id)) {
      // Replace the selection with the single sub_workflow step at the entry slot.
      if (step.id === entryStepId && !inserted) {
        parentSteps.push(subWorkflowStep);
        inserted = true;
      }
      continue;
    }
    // Rewire any edge that pointed into the selection to the sub_workflow step.
    const rewired = getNextIds(step).map((t) => (sel.has(t) ? subWorkflowStepId : t));
    parentSteps.push(setNextIds(step, [...new Set(rewired)]));
  }
  if (!inserted) parentSteps.push(subWorkflowStep);

  const parent: WorkflowTemplate = { ...template, steps: parentSteps };
  return { ok: true, child, parent };
}
