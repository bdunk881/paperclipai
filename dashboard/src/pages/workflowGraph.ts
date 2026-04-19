import { MarkerType, type Edge } from "@xyflow/react";
import type { StepKind, WorkflowStep } from "../types/workflow";

export const STEP_POSITION_KEY = "__uiPosition";
const STEP_NEXT_IDS_KEY = "__uiNextStepIds";

type EdgeValidationInput = {
  sourceId: string;
  targetId: string;
  steps: WorkflowStep[];
  edges: Edge[];
};

export type EdgeValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

const TRIGGER_KINDS: ReadonlySet<StepKind> = new Set(["trigger", "file_trigger"]);

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
    style: { stroke: "#9ca3af", strokeWidth: 2 },
  };
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

  if (source.kind === "output") {
    return { valid: false, reason: "Output steps cannot connect to another step." };
  }

  if (isTriggerKind(target.kind)) {
    return { valid: false, reason: "Trigger steps cannot have incoming edges." };
  }

  const outgoingCount = edges.filter((edge) => edge.source === sourceId).length;
  const incomingCount = edges.filter((edge) => edge.target === targetId).length;
  const maxOutgoing = source.kind === "condition" ? 2 : 1;

  if (outgoingCount >= maxOutgoing) {
    return {
      valid: false,
      reason:
        source.kind === "condition"
          ? "Condition steps support at most two outgoing edges."
          : "This step already has an outgoing edge.",
    };
  }

  if (incomingCount >= 1) {
    return { valid: false, reason: "Each step can only have one incoming edge." };
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
    return "At least one Trigger or File Trigger step is required.";
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
    return `Step \"${unreachable.name}\" is not reachable from a trigger.`;
  }

  const disconnected = steps.find(
    (step) => !isTriggerKind(step.kind) && (incomingCount.get(step.id) ?? 0) === 0,
  );
  if (disconnected) {
    return `Step \"${disconnected.name}\" needs an incoming edge.`;
  }

  return null;
}
