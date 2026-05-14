/**
 * Reflection job (HEL-91) — distills clusters of episodes into synthesized
 * Layer-2 knowledge items with citations back to the source episodes.
 *
 * v1 ships as a manual "Run consolidation now" trigger (`POST /api/knowledge/reflect`).
 * Activity-gated automation lands in P3 once we see real episode-stream
 * sizes and can tune the cadence.
 *
 * Pipeline:
 *   1. Query unreflected episodes in this workspace from the last N days.
 *   2. Cluster by embedding similarity (naive greedy, cosine ≥ 0.8).
 *   3. For each cluster of size ≥ 3, call the workspace's `small` tier LLM
 *      with a structured-output prompt asking for a durable fact + confidence.
 *   4. If confidence ≥ 0.6, insert a `knowledge_items` row with
 *      `kind='synthesized'`, citations to the source episodes, trust 0.7.
 *   5. Mark all processed episodes with `reflected_at = now()` so re-runs
 *      are idempotent.
 *
 * Pure-logic input/output here — the caller wires the LLM + embedding
 * functions + DB pool.
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { clusterByEmbedding, type ClusterableItem } from "./clustering";

export interface ReflectionDeps {
  pool: Pool;
  /**
   * Calls the workspace's small-tier LLM with a structured-output prompt and
   * returns the parsed result. Caller's responsibility to translate the
   * NormalizedRequest into the right adapter via the tier router.
   */
  llmReflect: (input: ReflectionPromptInput) => Promise<ReflectionPromptOutput | null>;
  /** Generate an embedding for the synthesized item (uses workspace's embeddings tier). */
  embedFn: (text: string) => Promise<number[]>;
}

export interface ReflectionPromptInput {
  workspaceContext: string;
  episodes: Array<{ id: string; title: string; summary: string; createdAt: string }>;
}

export interface ReflectionPromptOutput {
  title: string;
  content: string;
  missionId?: string | null;
  confidence: number; // 0..1
}

export interface ReflectionRunArgs {
  workspaceId: string;
  userId: string;
  /** How many days back to look. Default 14. */
  lookbackDays?: number;
  /** Workspace-context blurb for the LLM prompt (mission summaries, etc.). */
  workspaceContext?: string;
  /** Confidence floor below which we discard the LLM's hypothesis. Default 0.6. */
  confidenceFloor?: number;
}

export interface ReflectionRunResult {
  clustersFound: number;
  itemsCreated: number;
  episodesProcessed: number;
  insertedItemIds: string[];
}

interface EpisodeRow {
  id: string;
  title: string;
  summary: string;
  mission_id: string | null;
  embedding: string | number[] | null;
  created_at: string;
}

function parseEmbedding(raw: string | number[] | null): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  // pgvector returns "[d1,d2,...]" by default
  if (raw.startsWith("[")) {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return [];
}

export async function runReflection(
  deps: ReflectionDeps,
  args: ReflectionRunArgs,
): Promise<ReflectionRunResult> {
  const lookback = args.lookbackDays ?? 14;
  const minConfidence = args.confidenceFloor ?? 0.6;

  const result: ReflectionRunResult = {
    clustersFound: 0,
    itemsCreated: 0,
    episodesProcessed: 0,
    insertedItemIds: [],
  };

  // 1. Load unreflected episodes from the lookback window
  const episodes = await withWorkspaceContext(
    deps.pool,
    { workspaceId: args.workspaceId, userId: args.userId },
    async (client) => {
      const r = await client.query<EpisodeRow>(
        `SELECT id, title, summary, mission_id, embedding::text AS embedding, created_at
           FROM agent_episodes
          WHERE reflected_at IS NULL
            AND created_at >= now() - ($1::int || ' days')::interval
          ORDER BY created_at DESC
          LIMIT 500`,
        [lookback],
      );
      return r.rows;
    },
  );

  if (episodes.length === 0) return result;

  // 2. Cluster by embedding
  const clusterableItems: ClusterableItem<EpisodeRow>[] = episodes
    .map((e) => ({ id: e.id, embedding: parseEmbedding(e.embedding), data: e }))
    .filter((c) => c.embedding.length > 0);

  const clusters = clusterByEmbedding(clusterableItems, {
    cosineThreshold: 0.8,
    minClusterSize: 3,
    maxClusters: 50,
  });

  result.clustersFound = clusters.length;

  // 3-5. For each cluster, ask the LLM + persist
  const processedEpisodeIds = new Set<string>();
  for (const cluster of clusters) {
    const hypothesis = await deps.llmReflect({
      workspaceContext: args.workspaceContext ?? "",
      episodes: cluster.members.map((m) => ({
        id: m.data.id,
        title: m.data.title,
        summary: m.data.summary,
        createdAt: m.data.created_at,
      })),
    });

    for (const m of cluster.members) processedEpisodeIds.add(m.data.id);

    if (!hypothesis || hypothesis.confidence < minConfidence) continue;
    if (!hypothesis.title?.trim() || !hypothesis.content?.trim()) continue;

    // 4. Embed the synthesized item so it's immediately searchable
    let embedding: number[];
    try {
      embedding = await deps.embedFn(hypothesis.title + "\n\n" + hypothesis.content);
    } catch {
      continue; // skip this cluster, leave episodes unmarked so a future run can retry
    }
    if (!embedding || embedding.length === 0) continue;

    const newItemId = randomUUID();
    const sourceEpisodeIds = cluster.members.map((m) => m.data.id);
    const embeddingLiteral = `[${embedding.join(",")}]`;
    // Prefer the most common mission tag across the cluster
    const missionTag = pickMostCommonMissionId(cluster.members.map((m) => m.data.mission_id));

    try {
      await withWorkspaceContext(
        deps.pool,
        { workspaceId: args.workspaceId, userId: args.userId },
        async (client) => {
          await client.query(
            `INSERT INTO knowledge_items
              (id, workspace_id, scope, kind, title, content, source_type, source_episode_ids,
               mission_id, trust_score, embedding)
             VALUES ($1, $2, 'workspace', 'synthesized', $3, $4, 'reflection',
                     $5::uuid[], $6, 0.7, $7::vector)`,
            [
              newItemId,
              args.workspaceId,
              hypothesis.title.trim(),
              hypothesis.content,
              sourceEpisodeIds,
              missionTag,
              embeddingLiteral,
            ],
          );
        },
      );
      result.itemsCreated += 1;
      result.insertedItemIds.push(newItemId);
    } catch {
      continue;
    }
  }

  // 5. Mark all processed episodes (whether they produced an item or not) so
  // we don't re-evaluate them in the next run.
  if (processedEpisodeIds.size > 0) {
    await withWorkspaceContext(
      deps.pool,
      { workspaceId: args.workspaceId, userId: args.userId },
      async (client) => {
        await client.query(
          "UPDATE agent_episodes SET reflected_at = now() WHERE id = ANY($1::uuid[])",
          [Array.from(processedEpisodeIds)],
        );
      },
    );
  }
  result.episodesProcessed = processedEpisodeIds.size;

  return result;
}

function pickMostCommonMissionId(missionIds: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const m of missionIds) {
    if (!m) continue;
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best: { id: string; n: number } | null = null;
  for (const [id, n] of counts.entries()) {
    if (!best || n > best.n) best = { id, n };
  }
  return best?.id ?? null;
}
