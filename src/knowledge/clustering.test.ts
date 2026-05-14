import { clusterByEmbedding } from "./clustering";

function vec(values: number[]): number[] {
  // L2-normalize so cosine similarity = dot product
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? values : values.map((v) => v / norm);
}

describe("clusterByEmbedding (HEL-91)", () => {
  it("returns empty when input is empty", () => {
    expect(clusterByEmbedding([])).toEqual([]);
  });

  it("creates one cluster from near-identical embeddings", () => {
    const items = [
      { id: "a", embedding: vec([1, 0.01, 0]), data: null },
      { id: "b", embedding: vec([1, 0.02, 0]), data: null },
      { id: "c", embedding: vec([1, 0, 0.01]), data: null },
    ];
    const clusters = clusterByEmbedding(items, { cosineThreshold: 0.8, minClusterSize: 3 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map((m) => m.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("separates orthogonal embeddings into different clusters", () => {
    const items = [
      { id: "x1", embedding: vec([1, 0, 0]), data: null },
      { id: "x2", embedding: vec([0.99, 0.01, 0]), data: null },
      { id: "x3", embedding: vec([0.98, 0.02, 0]), data: null },
      { id: "y1", embedding: vec([0, 1, 0]), data: null },
      { id: "y2", embedding: vec([0.01, 0.99, 0]), data: null },
      { id: "y3", embedding: vec([0.02, 0.98, 0]), data: null },
    ];
    const clusters = clusterByEmbedding(items, { cosineThreshold: 0.8, minClusterSize: 3 });
    expect(clusters).toHaveLength(2);
    const sizes = clusters.map((c) => c.members.length).sort();
    expect(sizes).toEqual([3, 3]);
  });

  it("drops clusters below minClusterSize", () => {
    const items = [
      { id: "lonely-1", embedding: vec([1, 0, 0]), data: null },
      { id: "lonely-2", embedding: vec([0, 1, 0]), data: null },
      // Both seed their own clusters but neither reaches min size 3
    ];
    expect(clusterByEmbedding(items, { minClusterSize: 3 })).toHaveLength(0);
  });

  it("respects maxClusters cap", () => {
    const items = Array.from({ length: 20 }, (_, i) => {
      // All orthogonal — would normally produce 20 clusters
      const e = new Array(20).fill(0);
      e[i] = 1;
      return { id: `c${i}`, embedding: vec(e), data: null };
    });
    const clusters = clusterByEmbedding(items, { maxClusters: 5, minClusterSize: 1 });
    expect(clusters.length).toBeLessThanOrEqual(5);
  });

  it("skips items with empty embeddings", () => {
    const items = [
      { id: "with", embedding: vec([1, 0, 0]), data: null },
      { id: "without", embedding: [], data: null },
      { id: "also-with", embedding: vec([0.99, 0.01, 0]), data: null },
      { id: "third", embedding: vec([0.98, 0.02, 0]), data: null },
    ];
    const clusters = clusterByEmbedding(items, { minClusterSize: 3 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map((m) => m.id)).not.toContain("without");
  });
});
