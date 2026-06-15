import { MarkerType, type Edge } from "@xyflow/react";
import type { StepKind, WorkflowStep } from "../types/workflow";

export const STEP_POSITION_KEY = "__uiPosition";
// HEL-778: exported so the extract-to-sub-workflow surgery can read/write the
// per-step adjacency (the canvas edge model).
export const STEP_NEXT_IDS_KEY = "__uiNextStepIds";
// HEL-791: a disabled step is skipped by the engine (transparent no-op). Mirrors
// the UI-meta keys above; the engine reads the same `config.__disabled`.
export const STEP_DISABLED_KEY = "__disabled";

export function isStepDisabled(step: WorkflowStep): boolean {
  return step.config?.[STEP_DISABLED_KEY] === true;
}

type EdgeValidationInput = {
  sourceId: string;
  targetId: string;
  steps: WorkflowStep[];
  edges: Edge[];
};

export type EdgeValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

const TRIGGER_KINDS: ReadonlySet<StepKind> = new Set([
  "trigger",
  "cron_trigger",
  "interval_trigger",
  "file_trigger",
  "form_trigger",
  "error_trigger",
  "chat_trigger",
  "sub_workflow_trigger",
]);

function getSerializedTargets(step: WorkflowStep): string[] | null {
  if (!step.config || typeof step.config !== "object") return null;
  if (!Object.prototype.hasOwnProperty.call(step.config, STEP_NEXT_IDS_KEY)) return null;

  const value = step.config[STEP_NEXT_IDS_KEY];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function hasSerializedGraph(steps: WorkflowStep[]): boolean {
  return steps.some((step) => getSerializedTargets(step) !== null);
}

function isTriggerKind(kind: StepKind): boolean {
  return TRIGGER_KINDS.has(kind);
}

export function buildDefaultEdge(source: string, target: string): Edge {
  return {
    id: `${source}-->${target}`,
    source,
    target,
    type: "bezier",
    animated: false,
    className: "workflow-edge",
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    style: { stroke: "#475569", strokeWidth: 2 },
  };
}

/**
 * HEL-793: collision-safe step id. `crypto.randomUUID()` avoids the
 * `Date.now()` collisions that would clobber entries in the stepId-keyed Yjs
 * graph map (HEL-795) when two collaborators add a step in the same
 * millisecond. Mirrors the pattern already used by the extract-to-sub-workflow
 * flow.
 */
export function makeStepId(): string {
  return `step-${crypto.randomUUID()}`;
}

export function buildEdgesFromSteps(steps: WorkflowStep[]): Edge[] {
  if (steps.length <= 1) return [];

  const stepIds = new Set(steps.map((step) => step.id));
  const serialized = hasSerializedGraph(steps);

  if (!serialized) {
    return steps.slice(0, -1).map((step, idx) => buildDefaultEdge(step.id, steps[idx + 1].id));
  }

  const seen = new Set<string>();
  const edges: Edge[] = [];

  for (const step of steps) {
    const targets = getSerializedTargets(step) ?? [];
    for (const target of targets) {
      if (!stepIds.has(target)) continue;
      const edgeId = `${step.id}-->${target}`;
      if (seen.has(edgeId)) continue;
      seen.add(edgeId);
      edges.push(buildDefaultEdge(step.id, target));
    }
  }

  return edges;
}

export function serializeEdgesToSteps(steps: WorkflowStep[], edges: Edge[]): WorkflowStep[] {
  const outgoingBySource = new Map<string, string[]>();
  const validIds = new Set(steps.map((step) => step.id));

  for (const edge of edges) {
    if (!validIds.has(edge.source) || !validIds.has(edge.target)) continue;
    const list = outgoingBySource.get(edge.source) ?? [];
    if (!list.includes(edge.target)) {
      list.push(edge.target);
      outgoingBySource.set(edge.source, list);
    }
  }

  return steps.map((step) => ({
    ...step,
    config: {
      ...(step.config ?? {}),
      [STEP_NEXT_IDS_KEY]: outgoingBySource.get(step.id) ?? [],
    },
  }));
}

function createsCycle(
  sourceId: string,
  targetId: string,
  edges: Edge[],
): boolean {
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge.target);
    adjacency.set(edge.source, list);
  }

  const candidateTargets = adjacency.get(sourceId) ?? [];
  candidateTargets.push(targetId);
  adjacency.set(sourceId, candidateTargets);

  const stack = [targetId];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node === sourceId) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    const next = adjacency.get(node) ?? [];
    for (const item of next) {
      stack.push(item);
    }
  }

  return false;
}

export function validateEdgeCandidate({
  sourceId,
  targetId,
  steps,
  edges,
}: EdgeValidationInput): EdgeValidationResult {
  if (sourceId === targetId) {
    return { valid: false, reason: "Self-referencing edges are not allowed." };
  }

  if (edges.some((edge) => edge.source === sourceId && edge.target === targetId)) {
    return { valid: false, reason: "This edge already exists." };
  }

  const stepById = new Map(steps.map((step) => [step.id, step]));
  const source = stepById.get(sourceId);
  const target = stepById.get(targetId);

  if (!source || !target) {
    return { valid: false, reason: "Edge references an unknown step." };
  }

  if (source.kind === "output" || source.kind === "stop_error") {
    return {
      valid: false,
      reason: "Output and Stop & Error steps cannot connect to another step.",
    };
  }

  if (isTriggerKind(target.kind)) {
    return { valid: false, reason: "Trigger steps cannot have incoming edges." };
  }

  const outgoingCount = edges.filter((edge) => edge.source === sourceId).length;
  const incomingCount = edges.filter((edge) => edge.target === targetId).length;
  // HEL-669: Switch steps fan out to many routes; condition stays 2-way; every
  // other kind is single-out (the simple linear/branch model).
  const maxOutgoing =
    source.kind === "condition" ? 2 : source.kind === "switch" ? 10 : 1;

  if (outgoingCount >= maxOutgoing) {
    return {
      valid: false,
      reason:
        source.kind === "condition"
          ? "Condition steps support at most two outgoing edges."
          : source.kind === "switch"
            ? "Switch steps support at most 10 routes."
            : "This step already has an outgoing edge.",
    };
  }

  // HEL-667: Merge steps are the join point — they may take multiple incoming
  // edges so branches can rejoin. Every other kind stays single-incoming, which
  // keeps the rest of the graph a simple linear/branch model.
  if (incomingCount >= 1 && target.kind !== "merge") {
    return {
      valid: false,
      reason: "Each step can only have one incoming edge — use a Merge step to join branches.",
    };
  }

  if (createsCycle(sourceId, targetId, edges)) {
    return { valid: false, reason: "This edge would introduce a cycle." };
  }

  return { valid: true };
}

export function validateGraphTopology(steps: WorkflowStep[], edges: Edge[]): string | null {
  if (steps.length <= 1) return null;

  const stepById = new Map(steps.map((step) => [step.id, step]));
  const incomingCount = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const step of steps) {
    incomingCount.set(step.id, 0);
    adjacency.set(step.id, []);
  }

  for (const edge of edges) {
    if (!stepById.has(edge.source) || !stepById.has(edge.target)) continue;
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
    const next = adjacency.get(edge.source) ?? [];
    next.push(edge.target);
    adjacency.set(edge.source, next);
  }

  const triggerIds = steps.filter((step) => isTriggerKind(step.kind)).map((step) => step.id);
  if (triggerIds.length === 0) {
    return "At least one Trigger step is required.";
  }

  const visited = new Set<string>();
  const queue = [...triggerIds];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const next = adjacency.get(current) ?? [];
    for (const target of next) {
      queue.push(target);
    }
  }

  const unreachable = steps.find((step) => !visited.has(step.id));
  if (unreachable) {
    return `Step "${unreachable.name}" is not reachable from a trigger.`;
  }

  const disconnected = steps.find(
    (step) => !isTriggerKind(step.kind) && (incomingCount.get(step.id) ?? 0) === 0,
  );
  if (disconnected) {
    return `Step "${disconnected.name}" needs an incoming edge.`;
  }

  return null;
}

// --- Copy / paste (HEL-686) -------------------------------------------------

export interface WorkflowClipboard {
  /** Deep-cloned snapshot of the copied steps. */
  steps: WorkflowStep[];
  /** Edges whose BOTH endpoints are in the selection (the internal sub-graph). */
  internalEdges: Edge[];
}

function readPosition(step: WorkflowStep): { x: number; y: number } | null {
  const candidate = step.config?.[STEP_POSITION_KEY];
  if (
    candidate &&
    typeof candidate === "object" &&
    "x" in candidate &&
    "y" in candidate &&
    typeof candidate.x === "number" &&
    typeof candidate.y === "number"
  ) {
    return { x: candidate.x, y: candidate.y };
  }
  return null;
}

/**
 * Snapshot a selection for the clipboard: the selected steps (deep-cloned so the
 * clipboard is immune to later edits) plus the edges internal to the selection.
 * Edges to non-selected steps are intentionally dropped — paste produces a
 * self-contained island.
 */
export function extractClipboard(
  steps: WorkflowStep[],
  selectedIds: Iterable<string>,
): WorkflowClipboard {
  const selected = new Set(selectedIds);
  const picked = steps.filter((step) => selected.has(step.id));
  const internalEdges = buildEdgesFromSteps(steps).filter(
    (edge) => selected.has(edge.source) && selected.has(edge.target),
  );
  return {
    steps: picked.map((step) => structuredClone(step)),
    internalEdges,
  };
}

/**
 * Paste the clipboard as a disconnected island: every copied step gets a fresh
 * id and an offset position, internal edges are remapped to the new ids, and the
 * result is re-serialized over the WHOLE graph so existing edges are preserved
 * (an implicit-linear graph is converted to explicit `__uiNextStepIds`, which is
 * exactly what a normal edge edit already produces — semantically identical).
 *
 * `makeId` + `offset` are injected for deterministic testing.
 */
export function pasteClipboard(
  existingSteps: WorkflowStep[],
  clipboard: WorkflowClipboard,
  makeId: () => string,
  offset = 48,
): { steps: WorkflowStep[]; pastedIds: string[] } {
  if (clipboard.steps.length === 0) {
    return { steps: existingSteps, pastedIds: [] };
  }

  const idMap = new Map<string, string>();
  for (const step of clipboard.steps) idMap.set(step.id, makeId());

  const pastedSteps: WorkflowStep[] = clipboard.steps.map((step) => {
    const pos = readPosition(step);
    return {
      ...step,
      id: idMap.get(step.id)!,
      config: {
        ...(step.config ?? {}),
        [STEP_POSITION_KEY]: {
          x: Math.round((pos?.x ?? 0) + offset),
          y: Math.round((pos?.y ?? 0) + offset),
        },
      },
    };
  });

  const pastedEdges = clipboard.internalEdges
    .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
    .map((edge) => buildDefaultEdge(idMap.get(edge.source)!, idMap.get(edge.target)!));

  const combinedSteps = [...existingSteps, ...pastedSteps];
  const combinedEdges = [...buildEdgesFromSteps(existingSteps), ...pastedEdges];

  return {
    steps: serializeEdgesToSteps(combinedSteps, combinedEdges),
    pastedIds: [...idMap.values()],
  };
}
