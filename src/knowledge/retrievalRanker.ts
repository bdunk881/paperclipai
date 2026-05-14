/**
 * Org-chart-aware composite retrieval ranker (HEL-89).
 *
 * Generic vector retrieval returns plausibly-related items. AutoFlow's
 * differentiation: agents are employees with reporting lines (org_edges).
 * A subagent's manager's prior context is a higher-signal source than a
 * stranger agent's memory. Retrieval weighting reflects the org chart.
 *
 * Composite scoring formula (applied at search time):
 *
 *   final_score = base_similarity
 *               × layer_weight       // knowledge=1.0, episode=0.5
 *               × trust_weight       // verified=1.2, document=1.0, pull=0.9, syn=0.85
 *               × scope_weight       // workspace=1.0, autoflow_curated=0.7
 *               × mission_weight     // current=1.3, other=0.6, none=1.0
 *               × org_weight         // own=0.9, manager=1.1, peer=1.0, stranger=0.7
 *               × recency_weight     // exp(-age_days / 30)
 *
 * `org_weight` walks `org_edges` to determine the relationship between the
 * requesting agent and the item's `author_agent_id`.
 *
 * Pure functions here — caller (HEL-87 search endpoints) provides the
 * candidate list and the org graph snapshot.
 */

export type Layer = "instruction" | "knowledge" | "episode";
export type KnowledgeKind = "document" | "connector_pull" | "synthesized" | "verified";
export type Scope = "autoflow_curated" | "workspace";

export interface RankCandidate {
  id: string;
  /** Cosine similarity 0..1 from the underlying vector search. */
  baseSimilarity: number;
  layer: Layer;
  kind?: KnowledgeKind;
  scope?: Scope;
  missionId?: string | null;
  authorAgentId?: string | null;
  createdAt: string | Date;
}

export interface RankContext {
  /** The agent doing the retrieval (for org-relationship calculation). null/undefined = no org weighting. */
  requestingAgentId?: string | null;
  /** Mission this retrieval is in service of (drives mission_weight). */
  currentMissionId?: string | null;
  /** Adjacency snapshot: for each agent, the agents that manage it (parents). */
  orgManagersByAgent?: Map<string, Set<string>>;
  /** Adjacency snapshot: for each agent, agents that report to it (children). */
  orgReportsByAgent?: Map<string, Set<string>>;
  /** Override the recency half-life in days (default 30). */
  recencyHalfLifeDays?: number;
  /** Override "now" for deterministic tests. */
  now?: Date;
}

export interface RankedCandidate extends RankCandidate {
  finalScore: number;
  breakdown: {
    base: number;
    layer: number;
    trust: number;
    scope: number;
    mission: number;
    org: number;
    recency: number;
  };
}

// ---------------------------------------------------------------------------
// Weight functions
// ---------------------------------------------------------------------------

function layerWeight(layer: Layer): number {
  switch (layer) {
    case "knowledge":
      return 1.0;
    case "episode":
      return 0.5;
    case "instruction":
      // Instructions are always inlined into prompts, not retrieved. If
      // somehow surfaced here, treat as authoritative.
      return 1.2;
  }
}

function trustWeight(kind: KnowledgeKind | undefined, layer: Layer): number {
  if (layer !== "knowledge") return 1.0;
  switch (kind) {
    case "verified":
      return 1.2;
    case "document":
      return 1.0;
    case "connector_pull":
      return 0.9;
    case "synthesized":
      return 0.85;
    default:
      return 1.0;
  }
}

function scopeWeight(scope: Scope | undefined): number {
  if (!scope) return 1.0;
  return scope === "autoflow_curated" ? 0.7 : 1.0;
}

function missionWeight(
  itemMissionId: string | null | undefined,
  currentMissionId: string | null | undefined,
): number {
  if (!itemMissionId) return 1.0; // unsegmented memory is neutral
  if (!currentMissionId) return 1.0; // no current mission, no boost or penalty
  return itemMissionId === currentMissionId ? 1.3 : 0.6;
}

/**
 * Org-relationship weight between the requesting agent and the author agent.
 *
 *  - own_authored          → 0.9 (slight down-weight — self-loops are noise)
 *  - direct manager        → 1.1 (your boss's notes matter)
 *  - direct report         → 1.0 (your subagents' notes are neutral; not boosted vs peers)
 *  - peer (shares a manager) → 1.0
 *  - stranger              → 0.7 (other agents in workspace; visible, down-weighted)
 *  - no author (human-written) → 1.0
 */
function orgWeight(
  requestingAgentId: string | null | undefined,
  authorAgentId: string | null | undefined,
  managersByAgent?: Map<string, Set<string>>,
  reportsByAgent?: Map<string, Set<string>>,
): number {
  if (!authorAgentId) return 1.0; // human-authored
  if (!requestingAgentId) return 1.0;
  if (authorAgentId === requestingAgentId) return 0.9;

  const requesterManagers = managersByAgent?.get(requestingAgentId) ?? null;
  const authorManagers = managersByAgent?.get(authorAgentId) ?? null;

  if (requesterManagers && requesterManagers.has(authorAgentId)) {
    return 1.1; // author manages me
  }

  const requesterReports = reportsByAgent?.get(requestingAgentId) ?? null;
  if (requesterReports && requesterReports.has(authorAgentId)) {
    return 1.0; // author is my report
  }

  // Peer = we share a manager
  if (requesterManagers && authorManagers) {
    for (const m of requesterManagers) {
      if (authorManagers.has(m)) {
        return 1.0;
      }
    }
  }

  return 0.7;
}

function recencyWeight(
  createdAt: string | Date,
  now: Date,
  halfLifeDays: number,
): number {
  const ts = typeof createdAt === "string" ? Date.parse(createdAt) : createdAt.getTime();
  const ageMs = Math.max(0, now.getTime() - ts);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.exp(-ageDays / halfLifeDays);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function rankCandidates(
  candidates: RankCandidate[],
  context: RankContext,
): RankedCandidate[] {
  const now = context.now ?? new Date();
  const halfLife = context.recencyHalfLifeDays ?? 30;

  const ranked: RankedCandidate[] = candidates.map((c) => {
    const base = clamp01(c.baseSimilarity);
    const layer = layerWeight(c.layer);
    const trust = trustWeight(c.kind, c.layer);
    const scope = scopeWeight(c.scope);
    const mission = missionWeight(c.missionId ?? null, context.currentMissionId ?? null);
    const org = orgWeight(
      context.requestingAgentId ?? null,
      c.authorAgentId ?? null,
      context.orgManagersByAgent,
      context.orgReportsByAgent,
    );
    const recency = recencyWeight(c.createdAt, now, halfLife);
    const finalScore = base * layer * trust * scope * mission * org * recency;
    return {
      ...c,
      finalScore,
      breakdown: { base, layer, trust, scope, mission, org, recency },
    };
  });

  ranked.sort((a, b) => b.finalScore - a.finalScore);
  return ranked;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// ---------------------------------------------------------------------------
// Org-graph snapshot helper
//
// Reads `org_edges (manager_agent_id, agent_id)` rows for a workspace and
// builds the bidirectional maps the ranker needs. The graph is small (per
// workspace), so we cache the full snapshot per request and let the next
// request rebuild. HEL-94 will add a cross-request cache.
// ---------------------------------------------------------------------------

export interface OrgEdge {
  managerAgentId: string;
  agentId: string;
}

export function buildOrgGraph(edges: OrgEdge[]): {
  managersByAgent: Map<string, Set<string>>;
  reportsByAgent: Map<string, Set<string>>;
} {
  const managersByAgent = new Map<string, Set<string>>();
  const reportsByAgent = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!managersByAgent.has(e.agentId)) managersByAgent.set(e.agentId, new Set());
    managersByAgent.get(e.agentId)!.add(e.managerAgentId);
    if (!reportsByAgent.has(e.managerAgentId)) reportsByAgent.set(e.managerAgentId, new Set());
    reportsByAgent.get(e.managerAgentId)!.add(e.agentId);
  }
  return { managersByAgent, reportsByAgent };
}
