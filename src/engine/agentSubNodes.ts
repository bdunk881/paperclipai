/**
 * AI agent sub-nodes (HEL-815, parent HEL-711). The n8n "AI Agent root node"
 * pattern: a Model / Memory / Tool sub-node attached to an agent step. The
 * attachments live INSIDE the agent step (`config.subNodes`) — they are NOT a
 * StepKind and never enter `template.steps`; the builder projects them as nodes
 * (HEL-816) and the engine folds them into the flat props the runtime already
 * consumes.
 *
 * Consumption (what attaching each sub-node actually does):
 *  - model → `llmConfigId` (+ `agentModel`, `llmTier`). In `handleAgent` the
 *    in-process provider is resolved from `llmConfigId` (a real model change);
 *    on the control-plane bridge, `provisionStepAgent` sets the agent's model
 *    from `agentModel ?? llmConfigId`.
 *  - tool → `agentSkills` (union). `inferSkills()` turns these into the
 *    provisioned agent's skill set, which the runtime injects as tools
 *    (real on the bridge path; the in-process single-call slot can't execute
 *    tools — a pre-existing limitation of that fallback).
 *  - memory → carried through unchanged in `config.subNodes`. Its consumption
 *    needs a control-plane agent-metadata field (HEL-818); not folded here.
 *
 * Pure + side-effect-free: returns a NEW step (or the original when there are no
 * sub-nodes), so callers can fold at the top of `handleAgent` and the
 * control-plane provisioning sees the same effective step.
 */

import type { WorkflowStep } from "../types/workflow";

export type AgentSubNodeKind = "model" | "memory" | "tool";

export interface AgentSubNode {
  id: string;
  kind: AgentSubNodeKind;
  config: Record<string, unknown>;
  /** Builder-only canvas position; ignored by the engine. */
  uiPosition?: { x: number; y: number };
}

const SUB_NODE_KINDS: readonly AgentSubNodeKind[] = ["model", "memory", "tool"];

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Read + validate the agent step's attached sub-nodes from `config.subNodes`. */
export function parseAgentSubNodes(step: WorkflowStep): AgentSubNode[] {
  const raw = (step.config ?? {})["subNodes"];
  if (!Array.isArray(raw)) return [];
  const out: AgentSubNode[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const kind = e["kind"];
    if (typeof kind !== "string" || !(SUB_NODE_KINDS as readonly string[]).includes(kind)) continue;
    const pos = asRecord(e["uiPosition"]);
    const hasPos = typeof pos["x"] === "number" && typeof pos["y"] === "number";
    out.push({
      id: asString(e["id"]) ?? `${kind}-${out.length}`,
      kind: kind as AgentSubNodeKind,
      config: asRecord(e["config"]),
      ...(hasPos ? { uiPosition: { x: pos["x"] as number, y: pos["y"] as number } } : {}),
    });
  }
  return out;
}

/**
 * Fold an agent step's attached sub-nodes into the flat WorkflowStep props the
 * runtime + control-plane provisioning consume. Returns the step unchanged for
 * non-agent steps or when there are no sub-nodes (zero behavior change on
 * existing workflows). The first model sub-node wins; all tool sub-nodes union.
 */
export function applyAgentSubNodes(step: WorkflowStep): WorkflowStep {
  if (step.kind !== "agent") return step;
  const subNodes = parseAgentSubNodes(step);
  if (subNodes.length === 0) return step;

  const next: WorkflowStep = { ...step };

  const modelSub = subNodes.find((s) => s.kind === "model");
  if (modelSub) {
    const llmConfigId = asString(modelSub.config["llmConfigId"]);
    const modelId = asString(modelSub.config["model"]);
    const tier = modelSub.config["tier"];
    if (llmConfigId) next.llmConfigId = llmConfigId;
    if (modelId) next.agentModel = modelId;
    if (tier === "lite" || tier === "standard" || tier === "power") next.llmTier = tier;
  }

  const toolSubs = subNodes.filter((s) => s.kind === "tool");
  if (toolSubs.length > 0) {
    const fromTools = toolSubs
      .map((t) => asString(t.config["skill"]) ?? asString(t.config["tool"]) ?? asString(t.config["slug"]))
      .filter((v): v is string => Boolean(v));
    const existing = Array.isArray(step.agentSkills)
      ? step.agentSkills.filter((s): s is string => typeof s === "string")
      : [];
    if (fromTools.length > 0) {
      next.agentSkills = Array.from(new Set([...existing, ...fromTools]));
    }
  }

  return next;
}
