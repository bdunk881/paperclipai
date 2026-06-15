/**
 * HEL-682 (Ph2) — "Tidy up" auto-layout for the workflow canvas.
 *
 * Positions are normally manual (`__uiPosition`). This computes a clean
 * top-to-bottom DAG layout with dagre (MIT) so a "Tidy up" control can rewrite
 * every node's position in one shot. Pure + deterministic — the caller applies
 * the result as a single Yjs transaction (one undo entry).
 *
 * The builder flows top→bottom (target handle on top, source on bottom), so we
 * keep dagre's `rankdir: "TB"`, matching the manual fallback in
 * WorkflowBuilder's readStepPosition (constant x, index-stepped y).
 */
import Dagre from "@dagrejs/dagre";
import type { Edge } from "@xyflow/react";
import type { WorkflowStep } from "../types/workflow";

export interface NodeDims {
  width: number;
  height: number;
}

/** Fallback box when a node hasn't been measured yet (matches a typical card). */
export const DEFAULT_NODE_DIMS: NodeDims = { width: 280, height: 96 };

export interface TidyLayoutOptions {
  rankdir?: "TB" | "LR";
  /** Gap between ranks (rows in TB). */
  ranksep?: number;
  /** Gap between nodes in the same rank. */
  nodesep?: number;
}

/**
 * Compute a tidy layout for the given steps + edges. Returns a map of step id →
 * top-left `{x, y}` (React Flow uses top-left coordinates; dagre returns
 * centers, so we offset by half the node's measured size). Steps with no node in
 * the resulting graph are omitted.
 */
export function tidyLayout(
  steps: WorkflowStep[],
  edges: Edge[],
  dims: Map<string, NodeDims> = new Map(),
  options: TidyLayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (steps.length === 0) return result;

  const graph = new Dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: options.rankdir ?? "TB",
    ranksep: options.ranksep ?? 90,
    nodesep: options.nodesep ?? 60,
  });

  const ids = new Set(steps.map((step) => step.id));
  for (const step of steps) {
    const size = dims.get(step.id) ?? DEFAULT_NODE_DIMS;
    graph.setNode(step.id, { width: size.width, height: size.height });
  }
  for (const edge of edges) {
    if (ids.has(edge.source) && ids.has(edge.target)) {
      graph.setEdge(edge.source, edge.target);
    }
  }

  Dagre.layout(graph);

  for (const step of steps) {
    const node = graph.node(step.id);
    if (!node) continue;
    result.set(step.id, {
      x: Math.round(node.x - node.width / 2),
      y: Math.round(node.y - node.height / 2),
    });
  }
  return result;
}
