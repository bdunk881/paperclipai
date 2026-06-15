/**
 * HEL-795 (Sub-phase A) — the workflow graph as a Yjs shared type.
 *
 * Today the builder graph (steps / edges / positions / config) lives in React
 * `template` state and is persisted over REST; only step *names* are in the Yjs
 * doc. This module moves the whole graph into the doc so a scoped
 * `Y.UndoManager` (A3b) gives real undo/redo and graph edits become
 * collaborative. It is gated behind `VITE_WF_DOC_GRAPH` (default OFF) in
 * WorkflowBuilder — when OFF nothing here runs in the live path.
 *
 * Schema (per the planning workflow's decision):
 *   doc.getMap("graph")
 *     ├── "steps": Y.Map<stepId, Y.Map>   // keyed by id for O(1) by-id access
 *     │     └── each step Y.Map: every top-level WorkflowStep field as a leaf
 *     │         (kind/name/description/inputKeys/outputKeys/…), plus the hoisted
 *     │         "x","y","next","order" leaves, plus a nested "cfg" Y.Map holding
 *     │         step.config (minus the hoisted __uiPosition / __uiNextStepIds).
 *     └── "__seeded": true                 // one-shot seed guard
 *   doc.getMap("stepNames")  // SEPARATE, pre-existing Y.Map<Y.Text> — names stay
 *                            // here (never re-parented); readSteps prefers it.
 *
 * The mutators in WorkflowBuilder keep computing a full next-steps array; the
 * doc path just swaps the SINK (applyStepsToDoc) and SOURCE (readSteps) for the
 * React-state one. `applyStepsToDoc` diffs by id so unchanged step Y.Maps keep
 * their identity (and their nested cfg Y.Map merges field-by-field).
 */

import * as Y from "yjs";
import type { WorkflowStep } from "../types/workflow";
import { STEP_POSITION_KEY, STEP_NEXT_IDS_KEY } from "./workflowGraph";

export const GRAPH_KEY = "graph";
const STEPS_KEY = "steps";
const SEEDED_KEY = "__seeded";

/** The pre-existing collaborative step-name map (Y.Map<Y.Text>). */
export const STEP_NAME_YMAP_KEY = "stepNames";

/**
 * Origin tags for `doc.transact`. The A3b `Y.UndoManager` tracks ONLY
 * `LOCAL_ORIGIN`, so a local user's edits are undoable while seed writes and
 * remote (collaborator) edits are not. Must be a stable module-level singleton —
 * `trackedOrigins` matches by identity, so a per-render object would silently
 * de-track after a remount.
 */
export const LOCAL_ORIGIN: { readonly source: "wf-builder-local" } = {
  source: "wf-builder-local",
};
export const SEED_ORIGIN = "wf-builder-seed";

/** Leaves that are hoisted / structural, not plain WorkflowStep top-level fields. */
const HOISTED_LEAVES = new Set(["x", "y", "next", "order", "cfg"]);

export function getGraphRoot(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(GRAPH_KEY);
}

function getStepsMapForRead(doc: Y.Doc): Y.Map<Y.Map<unknown>> | undefined {
  return getGraphRoot(doc).get(STEPS_KEY) as Y.Map<Y.Map<unknown>> | undefined;
}

/** Get-or-create the steps map. MUST be called inside a transaction. */
function getStepsMapForWrite(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  const root = getGraphRoot(doc);
  let steps = root.get(STEPS_KEY) as Y.Map<Y.Map<unknown>> | undefined;
  if (!steps) {
    steps = new Y.Map<Y.Map<unknown>>();
    root.set(STEPS_KEY, steps);
  }
  return steps;
}

/** True once the graph has been seeded from a loaded template (one-shot). */
export function isGraphSeeded(doc: Y.Doc): boolean {
  return getGraphRoot(doc).get(SEEDED_KEY) === true;
}

/** Has the doc graph been populated with any steps? */
export function isGraphEmpty(doc: Y.Doc): boolean {
  const steps = getStepsMapForRead(doc);
  return !steps || steps.size === 0;
}

function splitConfig(step: WorkflowStep): {
  x: number | null;
  y: number | null;
  next: string[];
  /**
   * Whether the step actually carried `__uiNextStepIds`. Preserved so the doc
   * keeps the absent-vs-empty distinction: `buildEdgesFromSteps` falls back to
   * implicit-linear adjacency only when NO step has the key, so storing `[]`
   * for a step that had no key would erase an implicit-linear chain.
   */
  hasNext: boolean;
  cfg: Record<string, unknown>;
} {
  const config = (step.config ?? {}) as Record<string, unknown>;
  const pos = config[STEP_POSITION_KEY] as { x?: number; y?: number } | undefined;
  const hasNext = Object.prototype.hasOwnProperty.call(config, STEP_NEXT_IDS_KEY);
  const nextRaw = config[STEP_NEXT_IDS_KEY];
  const next = Array.isArray(nextRaw)
    ? nextRaw.filter((v): v is string => typeof v === "string")
    : [];
  const cfg: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (k === STEP_POSITION_KEY || k === STEP_NEXT_IDS_KEY) continue;
    cfg[k] = v;
  }
  return {
    x: typeof pos?.x === "number" ? pos.x : null,
    y: typeof pos?.y === "number" ? pos.y : null,
    next,
    hasNext,
    cfg,
  };
}

/** Write a single step's fields into its (existing or new) Y.Map. */
function writeStepMap(
  stepsMap: Y.Map<Y.Map<unknown>>,
  step: WorkflowStep,
  order: number,
): void {
  let stepMap = stepsMap.get(step.id);
  if (!stepMap) {
    stepMap = new Y.Map<unknown>();
    stepsMap.set(step.id, stepMap);
  }
  const { x, y, next, hasNext, cfg } = splitConfig(step);

  // Top-level WorkflowStep fields (everything except id + config) become leaves.
  const keep = new Set<string>(["x", "y", "order", "cfg"]);
  if (hasNext) keep.add("next");
  for (const [k, v] of Object.entries(step)) {
    if (k === "id" || k === "config") continue;
    stepMap.set(k, v);
    keep.add(k);
  }
  stepMap.set("x", x);
  stepMap.set("y", y);
  stepMap.set("order", order);
  // Preserve absent-vs-empty for adjacency (see splitConfig.hasNext).
  if (hasNext) stepMap.set("next", next);
  else stepMap.delete("next");

  // Remove any stale top-level leaves that are no longer present on the step.
  for (const existingKey of [...stepMap.keys()]) {
    if (!keep.has(existingKey)) stepMap.delete(existingKey);
  }

  // cfg as a nested Y.Map so concurrent edits to different config fields merge.
  let cfgMap = stepMap.get("cfg") as Y.Map<unknown> | undefined;
  if (!cfgMap) {
    cfgMap = new Y.Map<unknown>();
    stepMap.set("cfg", cfgMap);
  }
  for (const [k, v] of Object.entries(cfg)) cfgMap.set(k, v);
  for (const existingKey of [...cfgMap.keys()]) {
    if (!(existingKey in cfg)) cfgMap.delete(existingKey);
  }
}

function readStepMap(
  id: string,
  stepMap: Y.Map<unknown>,
  stepNames?: Y.Map<Y.Text> | undefined,
): { step: WorkflowStep; order: number } {
  const out: Record<string, unknown> = { id };
  for (const [k, v] of stepMap.entries()) {
    if (HOISTED_LEAVES.has(k)) continue;
    out[k] = v;
  }
  const x = stepMap.get("x");
  const y = stepMap.get("y");
  const cfgMap = stepMap.get("cfg") as Y.Map<unknown> | undefined;
  const cfg = cfgMap ? (cfgMap.toJSON() as Record<string, unknown>) : {};

  const config: Record<string, unknown> = { ...cfg };
  if (typeof x === "number" && typeof y === "number") {
    config[STEP_POSITION_KEY] = { x, y };
  }
  // Only re-add adjacency when the step actually carried it (preserve
  // absent-vs-empty so implicit-linear chains survive a round-trip).
  if (stepMap.has("next")) {
    const nextRaw = stepMap.get("next");
    config[STEP_NEXT_IDS_KEY] = Array.isArray(nextRaw)
      ? nextRaw.filter((v): v is string => typeof v === "string")
      : [];
  }

  // Prefer the live collaborative name (stepNames Y.Text) over the leaf.
  const liveName = stepNames?.get(id);
  const name =
    liveName && liveName.length > 0 ? liveName.toString() : (out.name as string) ?? "";

  const orderRaw = stepMap.get("order");
  const order = typeof orderRaw === "number" ? orderRaw : 0;

  return { step: { ...(out as unknown as WorkflowStep), name, config }, order };
}

/**
 * Read the graph back as a WorkflowStep[] (sorted by the `order` leaf).
 * Pure — performs no mutation, safe to call on every render tick.
 */
export function readSteps(doc: Y.Doc): WorkflowStep[] {
  const stepsMap = getStepsMapForRead(doc);
  if (!stepsMap) return [];
  const stepNames = doc.getMap<Y.Text>(STEP_NAME_YMAP_KEY);
  const rows: Array<{ step: WorkflowStep; order: number }> = [];
  stepsMap.forEach((stepMap, id) => {
    rows.push(readStepMap(id, stepMap, stepNames));
  });
  rows.sort((a, b) => a.order - b.order);
  return rows.map((r) => r.step);
}

/**
 * Diff a full steps[] into the doc graph in ONE transaction (one undo entry).
 * Unchanged step Y.Maps keep their identity; removed ids are deleted; `order`
 * is the array index. The mutators in WorkflowBuilder keep computing the
 * next-steps array exactly as today and call this instead of `setTemplate`.
 */
export function applyStepsToDoc(
  doc: Y.Doc,
  steps: WorkflowStep[],
  origin: unknown = LOCAL_ORIGIN,
): void {
  doc.transact(() => {
    const stepsMap = getStepsMapForWrite(doc);
    const desired = new Set(steps.map((s) => s.id));
    for (const existingId of [...stepsMap.keys()]) {
      if (!desired.has(existingId)) stepsMap.delete(existingId);
    }
    steps.forEach((step, index) => writeStepMap(stepsMap, step, index));
  }, origin);
}

/**
 * One-shot seed of the doc graph from a loaded template's steps. Guarded so a
 * reconnect or a second concurrent client can't double-populate: only seeds
 * when the graph is empty AND not already seeded, claiming `__seeded` in the
 * same transaction. Written under SEED_ORIGIN so it never enters the undo stack.
 */
export function seedGraphFromSteps(doc: Y.Doc, steps: WorkflowStep[]): boolean {
  let seeded = false;
  doc.transact(() => {
    if (isGraphSeeded(doc) || !isGraphEmpty(doc)) return;
    const stepsMap = getStepsMapForWrite(doc);
    steps.forEach((step, index) => writeStepMap(stepsMap, step, index));
    getGraphRoot(doc).set(SEEDED_KEY, true);
    seeded = true;
  }, SEED_ORIGIN);
  return seeded;
}
