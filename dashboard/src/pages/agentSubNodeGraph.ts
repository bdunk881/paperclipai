/**
 * AI agent sub-nodes — builder projection + config mutations (HEL-816, parent
 * HEL-711). Mirrors the engine's `src/engine/agentSubNodes.ts` data model:
 * attachments live INSIDE the agent step at `config.subNodes` (NOT a StepKind),
 * so they never enter `template.steps` and the DAG validation never sees them.
 *
 * This module is pure (no React / React Flow imports) so it unit-tests cleanly:
 *  - read / add / update / remove sub-nodes on a step's `config.subNodes`
 *  - project an agent's sub-nodes into plain node + edge shapes the builder wraps
 *    into React Flow nodes/edges (display-only in this PR; drag/select is HEL-817).
 */

import type { WorkflowStep } from "../types/workflow";

export type AgentSubNodeKind = "model" | "memory" | "tool";

export interface AgentSubNodeEntry {
  id: string;
  kind: AgentSubNodeKind;
  config: Record<string, unknown>;
  /** Builder canvas position; absent until the user drags (HEL-817). */
  uiPosition?: { x: number; y: number };
}

export const AGENT_SUB_NODE_KINDS: readonly AgentSubNodeKind[] = ["model", "memory", "tool"];

export interface SubNodeKindMeta {
  label: string;
  /** Short helper shown in the inspector + on the node. */
  blurb: string;
  port: string;
}

export const SUB_NODE_KIND_META: Record<AgentSubNodeKind, SubNodeKindMeta> = {
  model: { label: "Chat Model", blurb: "The model this agent runs on", port: "port:model" },
  memory: { label: "Memory", blurb: "Recall prior context into the agent", port: "port:memory" },
  tool: { label: "Tool", blurb: "A skill/tool the agent can call", port: "port:tool" },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Read + validate an agent step's sub-nodes from `config.subNodes`. */
export function readAgentSubNodes(step: Pick<WorkflowStep, "config">): AgentSubNodeEntry[] {
  const raw = (step.config ?? {})["subNodes"];
  if (!Array.isArray(raw)) return [];
  const out: AgentSubNodeEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const kind = e["kind"];
    if (typeof kind !== "string" || !(AGENT_SUB_NODE_KINDS as readonly string[]).includes(kind)) {
      continue;
    }
    const pos = asRecord(e["uiPosition"]);
    const hasPos = typeof pos["x"] === "number" && typeof pos["y"] === "number";
    out.push({
      id: typeof e["id"] === "string" && e["id"] ? e["id"] : `${kind}-${out.length}`,
      kind: kind as AgentSubNodeKind,
      config: asRecord(e["config"]),
      ...(hasPos ? { uiPosition: { x: pos["x"] as number, y: pos["y"] as number } } : {}),
    });
  }
  return out;
}

function makeSubNodeId(kind: AgentSubNodeKind): string {
  const rand =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  return `${kind}-${rand}`;
}

/**
 * Add a sub-node of `kind`. Only one `model` and one `memory` are allowed (they
 * are singular ports); `tool` is repeatable. Returns the next sub-node array
 * unchanged when a singular kind already exists.
 */
export function addAgentSubNode(
  step: Pick<WorkflowStep, "config">,
  kind: AgentSubNodeKind,
): AgentSubNodeEntry[] {
  const current = readAgentSubNodes(step);
  if ((kind === "model" || kind === "memory") && current.some((s) => s.kind === kind)) {
    return current;
  }
  return [...current, { id: makeSubNodeId(kind), kind, config: {} }];
}

/** Replace one sub-node's config (shallow merge). */
export function updateAgentSubNode(
  step: Pick<WorkflowStep, "config">,
  subNodeId: string,
  configPatch: Record<string, unknown>,
): AgentSubNodeEntry[] {
  return readAgentSubNodes(step).map((s) =>
    s.id === subNodeId ? { ...s, config: { ...s.config, ...configPatch } } : s,
  );
}

/** Remove one sub-node. */
export function removeAgentSubNode(
  step: Pick<WorkflowStep, "config">,
  subNodeId: string,
): AgentSubNodeEntry[] {
  return readAgentSubNodes(step).filter((s) => s.id !== subNodeId);
}

/** HEL-817: persist a dragged sub-node's canvas position into its config. */
export function setAgentSubNodePosition(
  step: Pick<WorkflowStep, "config">,
  subNodeId: string,
  uiPosition: { x: number; y: number },
): AgentSubNodeEntry[] {
  return readAgentSubNodes(step).map((s) =>
    s.id === subNodeId ? { ...s, uiPosition } : s,
  );
}

/** The React-Flow node id for a projected sub-node (stable, agent-scoped). */
export function subNodeElementId(agentId: string, subNodeId: string): string {
  return `agentsub:${agentId}:${subNodeId}`;
}

/** Inverse of subNodeElementId — `null` when the id isn't a sub-node id. */
export function parseSubNodeElementId(
  elementId: string,
): { agentId: string; subNodeId: string } | null {
  const m = /^agentsub:([^:]+):(.+)$/.exec(elementId);
  return m ? { agentId: m[1]!, subNodeId: m[2]! } : null;
}

export interface ProjectedSubNode {
  id: string;
  agentId: string;
  agentName: string;
  subNodeId: string;
  kind: AgentSubNodeKind;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface ProjectedSubNodeEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
}

// Auto-layout offsets beneath the agent (until the user drags — HEL-817).
const SUB_NODE_DROP_Y = 200;
const SUB_NODE_GAP_X = 230;

/**
 * Project every agent step's sub-nodes into plain node + edge shapes. The
 * builder wraps these into React Flow nodes/edges. Positions use the sub-node's
 * `uiPosition` when set, else auto-place in a row beneath the agent.
 */
export function projectAgentSubNodes(
  steps: WorkflowStep[],
  positionOf: (stepId: string) => { x: number; y: number },
): { nodes: ProjectedSubNode[]; edges: ProjectedSubNodeEdge[] } {
  const nodes: ProjectedSubNode[] = [];
  const edges: ProjectedSubNodeEdge[] = [];
  for (const step of steps) {
    if (step.kind !== "agent") continue;
    const subNodes = readAgentSubNodes(step);
    if (subNodes.length === 0) continue;
    const base = positionOf(step.id);
    subNodes.forEach((sub, i) => {
      const elementId = subNodeElementId(step.id, sub.id);
      const position = sub.uiPosition ?? {
        x: base.x + (i - (subNodes.length - 1) / 2) * SUB_NODE_GAP_X,
        y: base.y + SUB_NODE_DROP_Y,
      };
      nodes.push({
        id: elementId,
        agentId: step.id,
        agentName: step.name,
        subNodeId: sub.id,
        kind: sub.kind,
        config: sub.config,
        position,
      });
      edges.push({
        id: `agentsubedge:${step.id}:${sub.id}`,
        source: step.id,
        sourceHandle: SUB_NODE_KIND_META[sub.kind].port,
        target: elementId,
      });
    });
  }
  return { nodes, edges };
}
