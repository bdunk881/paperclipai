/**
 * Memory API client (HEL-90).
 *
 * Mirrors:
 *   - src/instructions/instructionRoutes.ts        (Layer 1)
 *   - src/knowledge/knowledgeItemRoutes.ts          (Layer 2)
 *   - src/episodes/episodeRoutes.ts                 (Layer 3)
 *   - src/knowledge/reflectionRoutes.ts             (manual reflection)
 *
 * Used by the WorkspaceMemory page (3-tab view) and the InstructionsEditor.
 */

import { getApiBasePath } from "./baseUrl";
import { trackedFetch } from "./trackedFetch";

const BASE = getApiBasePath();

// ---------------------------------------------------------------------------
// Types — kept lightweight; the dashboard doesn't need every backend field.
// ---------------------------------------------------------------------------

export interface Instruction {
  id: string;
  workspaceId: string;
  missionId: string | null;
  kind: "instruction" | "triage_policy";
  title: string;
  body: string;
  version: number;
  authorUserId: string | null;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeItem {
  id: string;
  workspaceId: string | null;
  scope: "autoflow_curated" | "workspace";
  kind: "document" | "connector_pull" | "synthesized" | "verified";
  title: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  sourceType: string;
  sourceRef: string | null;
  sourceEpisodeIds: string[];
  missionId: string | null;
  authorUserId: string | null;
  authorAgentId: string | null;
  trustScore: number;
  supersededBy: string | null;
  validUntil: string | null;
  embeddingVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface Episode {
  id: string;
  workspaceId: string;
  agentId: string;
  missionId: string | null;
  runId: string | null;
  episodeType: "observation" | "action_result" | "reflection" | "escalation";
  title: string;
  summary: string;
  evidence: Record<string, unknown>;
  embeddingVersion: number;
  ttlDays: number;
  expiresAt: string;
  reflectedAt: string | null;
  createdAt: string;
}

export interface ReflectionResult {
  clustersFound: number;
  itemsCreated: number;
  episodesProcessed: number;
  insertedItemIds: string[];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function authHeaders(token: string, extra?: HeadersInit): HeadersInit {
  return { ...(extra ?? {}), Authorization: `Bearer ${token}` };
}

async function parseOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `${fallback} (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

export async function listInstructions(
  token: string,
  opts?: { kind?: Instruction["kind"]; missionId?: string; agentId?: string },
): Promise<Instruction[]> {
  const params = new URLSearchParams();
  if (opts?.kind) params.set("kind", opts.kind);
  if (opts?.missionId) params.set("mission_id", opts.missionId);
  if (opts?.agentId) params.set("agent_id", opts.agentId);
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await trackedFetch(`${BASE}/instructions${query}`, { headers: authHeaders(token) });
  const payload = await parseOrThrow<{ instructions: Instruction[] }>(res, "Failed to list instructions");
  return payload.instructions;
}

export async function getInstruction(id: string, token: string): Promise<Instruction | null> {
  const res = await trackedFetch(`${BASE}/instructions/${encodeURIComponent(id)}`, {
    headers: authHeaders(token),
  });
  if (res.status === 404) return null;
  return parseOrThrow<Instruction>(res, "Failed to fetch instruction");
}

export interface InstructionCreateInput {
  title: string;
  body: string;
  kind?: "instruction" | "triage_policy";
  mission_id?: string;
  agent_id?: string;
}

export async function createInstruction(
  input: InstructionCreateInput,
  token: string,
): Promise<Instruction> {
  const res = await trackedFetch(`${BASE}/instructions`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  return parseOrThrow<Instruction>(res, "Failed to create instruction");
}

export async function updateInstruction(
  id: string,
  input: { title?: string; body?: string },
  token: string,
): Promise<Instruction> {
  const res = await trackedFetch(`${BASE}/instructions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  return parseOrThrow<Instruction>(res, "Failed to update instruction");
}

export async function deleteInstruction(id: string, token: string): Promise<void> {
  const res = await trackedFetch(`${BASE}/instructions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok && res.status !== 204) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Failed to delete instruction (${res.status})`);
  }
}

// ---------------------------------------------------------------------------
// Knowledge items
// ---------------------------------------------------------------------------

export async function listKnowledgeItems(
  token: string,
  opts?: { kind?: KnowledgeItem["kind"]; missionId?: string; trustMin?: number; includeSuperseded?: boolean; limit?: number },
): Promise<KnowledgeItem[]> {
  const params = new URLSearchParams();
  if (opts?.kind) params.set("kind", opts.kind);
  if (opts?.missionId) params.set("mission_id", opts.missionId);
  if (typeof opts?.trustMin === "number") params.set("trust_min", String(opts.trustMin));
  if (opts?.includeSuperseded) params.set("include_superseded", "true");
  if (opts?.limit) params.set("limit", String(opts.limit));
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await trackedFetch(`${BASE}/knowledge-items${query}`, { headers: authHeaders(token) });
  const payload = await parseOrThrow<{ items: KnowledgeItem[] }>(res, "Failed to list knowledge items");
  return payload.items;
}

export async function getKnowledgeItem(id: string, token: string): Promise<KnowledgeItem | null> {
  const res = await trackedFetch(`${BASE}/knowledge-items/${encodeURIComponent(id)}`, {
    headers: authHeaders(token),
  });
  if (res.status === 404) return null;
  return parseOrThrow<KnowledgeItem>(res, "Failed to fetch knowledge item");
}

export async function supersedeKnowledgeItem(
  id: string,
  supersededBy: string,
  token: string,
): Promise<KnowledgeItem> {
  const res = await trackedFetch(`${BASE}/knowledge-items/${encodeURIComponent(id)}/supersede`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ superseded_by: supersededBy }),
  });
  return parseOrThrow<KnowledgeItem>(res, "Failed to supersede knowledge item");
}

export async function deleteKnowledgeItem(id: string, token: string): Promise<void> {
  const res = await trackedFetch(`${BASE}/knowledge-items/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok && res.status !== 204) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Failed to delete knowledge item (${res.status})`);
  }
}

// ---------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------

export async function listEpisodes(
  token: string,
  opts?: {
    agentId?: string;
    missionId?: string;
    runId?: string;
    episodeType?: Episode["episodeType"];
    since?: string;
    unreflectedOnly?: boolean;
    limit?: number;
  },
): Promise<Episode[]> {
  const params = new URLSearchParams();
  if (opts?.agentId) params.set("agent_id", opts.agentId);
  if (opts?.missionId) params.set("mission_id", opts.missionId);
  if (opts?.runId) params.set("run_id", opts.runId);
  if (opts?.episodeType) params.set("episode_type", opts.episodeType);
  if (opts?.since) params.set("since", opts.since);
  if (opts?.unreflectedOnly) params.set("unreflected_only", "true");
  if (opts?.limit) params.set("limit", String(opts.limit));
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await trackedFetch(`${BASE}/episodes${query}`, { headers: authHeaders(token) });
  const payload = await parseOrThrow<{ episodes: Episode[] }>(res, "Failed to list episodes");
  return payload.episodes;
}

export async function getEpisode(id: string, token: string): Promise<Episode | null> {
  const res = await trackedFetch(`${BASE}/episodes/${encodeURIComponent(id)}`, {
    headers: authHeaders(token),
  });
  if (res.status === 404) return null;
  return parseOrThrow<Episode>(res, "Failed to fetch episode");
}

// ---------------------------------------------------------------------------
// Reflection
// ---------------------------------------------------------------------------

export async function runReflection(
  token: string,
  opts?: { lookbackDays?: number; workspaceContext?: string },
): Promise<ReflectionResult> {
  const res = await trackedFetch(`${BASE}/knowledge/reflect`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      lookback_days: opts?.lookbackDays,
      workspace_context: opts?.workspaceContext,
    }),
  });
  return parseOrThrow<ReflectionResult>(res, "Failed to run reflection");
}
