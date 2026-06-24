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
 *  - memory → recalled into the agent prompt at run time (HEL-818) via the
 *    run's `context.memory` helper (the persistent `memoryStore`), scoped by the
 *    sub-node's query/limit. Not a flat-prop fold — see `resolveAgentMemoryConfig`
 *    + `buildMemoryRecallBlock`, consumed in `handleAgent`.
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

/** A normalized memory sub-node: what to recall + how many entries. */
export interface AgentMemoryConfig {
  /** Relevance query; "" recalls the most recent / all (capped by limit). */
  query: string;
  limit: number;
}

const DEFAULT_MEMORY_RECALL_LIMIT = 10;

/**
 * The agent's memory sub-node (first one wins), normalized. Returns undefined
 * when the agent has no memory sub-node — the caller then injects nothing.
 */
export function resolveAgentMemoryConfig(step: WorkflowStep): AgentMemoryConfig | undefined {
  if (step.kind !== "agent") return undefined;
  const mem = parseAgentSubNodes(step).find((s) => s.kind === "memory");
  if (!mem) return undefined;
  const limitRaw = mem.config["limit"];
  const n =
    typeof limitRaw === "number" ? limitRaw : typeof limitRaw === "string" ? Number(limitRaw) : NaN;
  return {
    query: asString(mem.config["query"]) ?? "",
    limit: Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MEMORY_RECALL_LIMIT,
  };
}

/**
 * Build the "Relevant memory" prompt block from the run's memory reader
 * (`context.memory.read`). Returns "" when there's no config, the reader throws,
 * or nothing is recalled — so the caller can unconditionally concatenate it.
 */
export function buildMemoryRecallBlock(
  config: AgentMemoryConfig | undefined,
  read: (query: string) => Array<{ key: string; text: string }>,
): string {
  if (!config) return "";
  let entries: Array<{ key: string; text: string }>;
  try {
    entries = read(config.query) ?? [];
  } catch {
    return "";
  }
  const top = entries.slice(0, config.limit).filter((e) => e && typeof e.text === "string");
  if (top.length === 0) return "";
  return ["Relevant memory (recall from prior runs):", ...top.map((e) => `- ${e.key}: ${e.text}`)].join(
    "\n",
  );
}

/** Narrow the run context's `memory` helper to its `read(query)` function. */
export function getMemoryReader(
  context: Record<string, unknown>,
): ((query: string) => Array<{ key: string; text: string }>) | undefined {
  const mem = context["memory"];
  if (mem && typeof mem === "object" && typeof (mem as { read?: unknown }).read === "function") {
    return (mem as { read: (query: string) => Array<{ key: string; text: string }> }).read;
  }
  return undefined;
}
