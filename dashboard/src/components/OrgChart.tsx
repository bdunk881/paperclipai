/**
 * Agent org chart (HEL-563, FEATURE_REVIEW.md §I1).
 *
 * Read-only manager→report graph from `org_edges`, rendered with the
 * @xyflow/react graph Studio already uses. The differentiator screen: "a
 * workforce, not a flowchart." Nodes carry live presence, current task, and
 * month-to-date spend; clicking a node opens that agent.
 *
 * Layout: there's no layout lib in the repo, so `buildOrgFlow` does a tidy
 * top-down tree pass (leaves spread left→right, parents centered over their
 * children) — exported pure so it's unit-tested without a DOM.
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { Agent } from "../api/agentApi";
import type { OrgGraphEdge } from "../api/canonicalApi";
import type { AgentPresence } from "../hooks/useAgentPresence";

export interface OrgChartSpend {
  spentUsd: number;
  monthlyUsd: number;
}

export interface OrgNodeData extends Record<string, unknown> {
  name: string;
  role: string;
  presence?: AgentPresence;
  spent?: number;
  budget?: number;
}

type OrgNode = Node<OrgNodeData, "orgAgent">;

const X_GAP = 230;
const Y_GAP = 150;

/**
 * Pure transform: agents + org edges → positioned ReactFlow nodes + edges.
 * Positions are deterministic from (agents, edges) only — presence/spend never
 * move a node — so the graph doesn't jump as live data streams in.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure builder co-located with its chart and unit-tested directly.
export function buildOrgFlow(
  agents: Agent[],
  edges: OrgGraphEdge[],
  presence: ReadonlyMap<string, AgentPresence>,
  budgets: ReadonlyMap<string, OrgChartSpend>,
): { nodes: OrgNode[]; edges: Edge[] } {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const childrenOf = new Map<string, string[]>();
  const hasManager = new Set<string>();
  for (const e of edges) {
    if (!byId.has(e.managerAgentId) || !byId.has(e.agentId)) continue;
    (childrenOf.get(e.managerAgentId) ?? childrenOf.set(e.managerAgentId, []).get(e.managerAgentId)!).push(
      e.agentId,
    );
    hasManager.add(e.agentId);
  }

  const roots = agents.filter((a) => !hasManager.has(a.id)).map((a) => a.id);
  const pos = new Map<string, { x: number; y: number }>();
  const visited = new Set<string>();
  let leafCursor = 0;

  // DFS tidy layout: leaves take the next x slot; a parent centers over its
  // children. `visited` guards against any accidental cycle (org_edges has a
  // cycle-prevention trigger, but be defensive).
  function place(id: string, depth: number): number {
    if (visited.has(id)) return pos.get(id)?.x ?? 0;
    visited.add(id);
    const kids = childrenOf.get(id) ?? [];
    let x: number;
    if (kids.length === 0) {
      x = leafCursor++;
    } else {
      const xs = kids.map((k) => place(k, depth + 1));
      x = xs.reduce((sum, v) => sum + v, 0) / xs.length;
    }
    pos.set(id, { x: x * X_GAP, y: depth * Y_GAP });
    return x;
  }
  for (const r of roots) place(r, 0);
  // Orphans (unreachable from any root) get a trailing slot so nothing vanishes.
  for (const a of agents) {
    if (!pos.has(a.id)) pos.set(a.id, { x: leafCursor++ * X_GAP, y: 0 });
  }

  const nodes: OrgNode[] = agents.map((a) => ({
    id: a.id,
    type: "orgAgent",
    position: pos.get(a.id) ?? { x: 0, y: 0 },
    data: {
      name: a.displayName?.trim() || a.name,
      role: a.roleKey ?? "agent",
      presence: presence.get(a.id),
      spent: budgets.get(a.id)?.spentUsd,
      budget: budgets.get(a.id)?.monthlyUsd,
    },
  }));

  const flowEdges: Edge[] = edges
    .filter((e) => byId.has(e.managerAgentId) && byId.has(e.agentId))
    .map((e) => ({
      id: e.id,
      source: e.managerAgentId,
      target: e.agentId,
      type: "smoothstep",
      style: { stroke: "rgba(26,20,16,0.18)", strokeWidth: 1.5 },
    }));

  return { nodes, edges: flowEdges };
}

function toneFor(state: AgentPresence["state"] | undefined): { dot: string; label: string } {
  switch (state) {
    case "working":
      return { dot: "var(--af2-sage)", label: "working" };
    case "idle":
      return { dot: "var(--af2-mustard)", label: "idle" };
    case "checking-in":
      return { dot: "var(--af2-mustard)", label: "checking in" };
    case "blocked":
      return { dot: "var(--af2-clay)", label: "blocked" };
    default:
      return { dot: "var(--af2-ink-4)", label: "offline" };
  }
}

function OrgAgentNode({ data }: NodeProps<OrgNode>) {
  const tone = toneFor(data.presence?.state);
  const task = data.presence?.currentTask;
  return (
    <div
      data-testid="org-chart-node"
      style={{
        width: 200,
        background: "var(--af2-card)",
        border: "1px solid var(--af2-line)",
        borderRadius: 10,
        padding: "10px 12px",
        boxShadow: "var(--af2-shadow)",
        fontFamily: "var(--af2-sans)",
        cursor: "pointer",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0, width: 1, height: 1 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          aria-hidden
          title={tone.label}
          style={{ width: 8, height: 8, borderRadius: "50%", background: tone.dot, flex: "none" }}
        />
        <strong style={{ fontSize: 13.5, color: "var(--af2-ink)" }}>{data.name}</strong>
      </div>
      <div style={{ fontSize: 11, color: "var(--af2-ink-3)", margin: "2px 0 0 15px" }}>{data.role}</div>
      {task ? (
        <div
          style={{
            fontSize: 11.5,
            color: "var(--af2-ink-2)",
            background: "var(--af2-paper-2)",
            borderRadius: 6,
            padding: "5px 7px",
            marginTop: 8,
            lineHeight: 1.35,
            maxHeight: 44,
            overflow: "hidden",
          }}
        >
          {task}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 8,
          fontSize: 11,
          color: "var(--af2-ink-3)",
        }}
      >
        <span>{tone.label}</span>
        {typeof data.spent === "number" ? (
          <span style={{ fontFamily: "var(--af2-mono)" }}>
            ${data.spent.toFixed(0)}
            {typeof data.budget === "number" && data.budget > 0 ? ` / $${data.budget.toFixed(0)}` : ""}
          </span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, width: 1, height: 1 }} />
    </div>
  );
}

const nodeTypes = { orgAgent: OrgAgentNode };

export function OrgChart({
  agents,
  edges,
  presence,
  budgets,
}: {
  agents: Agent[];
  edges: OrgGraphEdge[];
  presence: ReadonlyMap<string, AgentPresence>;
  budgets: ReadonlyMap<string, OrgChartSpend>;
}) {
  const navigate = useNavigate();
  const { nodes, edges: flowEdges } = useMemo(
    () => buildOrgFlow(agents, edges, presence, budgets),
    [agents, edges, presence, budgets],
  );

  if (agents.length === 0) {
    return (
      <div
        className="af2-empty"
        style={{
          border: "1px dashed var(--af2-line-2)",
          borderRadius: 12,
          padding: "44px 28px",
          textAlign: "center",
          color: "var(--af2-ink-3)",
        }}
      >
        No agents yet — brief a mission to build your first team.
      </div>
    );
  }

  return (
    <div
      style={{
        height: "68vh",
        minHeight: 420,
        border: "1px solid var(--af2-line)",
        borderRadius: 12,
        background: "var(--af2-paper)",
        overflow: "hidden",
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.3}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={(_evt, node) => navigate(`/agents/${node.id}`)}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="rgba(26,20,16,0.10)" />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
