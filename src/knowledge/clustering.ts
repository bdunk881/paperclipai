/**
 * Embedding-cluster grouping (HEL-91).
 *
 * Naive greedy single-link clustering: walk the sorted list of items, and
 * for each, attach to the first existing cluster whose centroid is within
 * `cosineThreshold` of this item — else seed a new cluster.
 *
 * Not as good as HDBSCAN but: zero dependencies, O(n × k) where k is
 * cluster count (small, bounded by maxClusters), and good enough for the
 * v1 reflection job. HEL-91.x can swap in HDBSCAN once we see real episode
 * stream sizes.
 *
 * Inputs are unit-normalized embeddings (caller's responsibility — pgvector
 * indexes use cosine, and our embedding model returns L2-normalized vectors).
 */

export interface ClusterableItem<T = unknown> {
  id: string;
  embedding: number[];
  data: T;
}

export interface Cluster<T = unknown> {
  centroid: number[];
  members: ClusterableItem<T>[];
}

export interface ClusterOptions {
  /** Cosine similarity threshold for joining a cluster. Default 0.8. */
  cosineThreshold?: number;
  /** Hard cap on cluster count to bound runtime. Default 50. */
  maxClusters?: number;
  /** Drop clusters with fewer than this many members. Default 3. */
  minClusterSize?: number;
}

export function clusterByEmbedding<T>(
  items: ClusterableItem<T>[],
  opts: ClusterOptions = {},
): Cluster<T>[] {
  const threshold = opts.cosineThreshold ?? 0.8;
  const maxClusters = opts.maxClusters ?? 50;
  const minSize = opts.minClusterSize ?? 3;

  const clusters: Cluster<T>[] = [];

  for (const item of items) {
    if (item.embedding.length === 0) continue;

    let best: { cluster: Cluster<T>; sim: number } | null = null;
    for (const cluster of clusters) {
      const sim = cosineSimilarity(item.embedding, cluster.centroid);
      if (sim >= threshold && (!best || sim > best.sim)) {
        best = { cluster, sim };
      }
    }

    if (best) {
      best.cluster.members.push(item);
      best.cluster.centroid = recomputeCentroid(best.cluster);
    } else if (clusters.length < maxClusters) {
      clusters.push({
        centroid: [...item.embedding],
        members: [item],
      });
    }
    // else: skip — we've hit the cluster cap. These items don't fit any
    // existing cluster and we can't create more. They'll be reflected on
    // in a future run.
  }

  return clusters.filter((c) => c.members.length >= minSize);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

function recomputeCentroid<T>(cluster: Cluster<T>): number[] {
  const dim = cluster.centroid.length;
  const sum = new Array(dim).fill(0);
  for (const m of cluster.members) {
    for (let i = 0; i < dim; i++) {
      sum[i] += m.embedding[i];
    }
  }
  const n = cluster.members.length;
  return sum.map((s) => s / n);
}
