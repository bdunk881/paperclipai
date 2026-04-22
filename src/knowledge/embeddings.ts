import OpenAI from "openai";

export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) {
    return vector;
  }
  return vector.map((value) => value / magnitude);
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function buildDeterministicEmbedding(text: string): number[] {
  const vector = new Array<number>(KNOWLEDGE_EMBEDDING_DIMENSIONS).fill(0);
  const tokens = text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return vector;
  }

  for (const token of tokens) {
    const hash = hashToken(token);
    const index = hash % KNOWLEDGE_EMBEDDING_DIMENSIONS;
    const sign = hash % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }

  return normalize(vector);
}

export async function embedText(text: string, apiKey?: string): Promise<number[]> {
  if (!apiKey) {
    console.warn(
      "[knowledge] OPENAI_API_KEY/default OpenAI provider not configured; using deterministic fallback embeddings with degraded semantic search quality."
    );
    return buildDeterministicEmbedding(text);
  }

  const client = new OpenAI({ apiKey });
  const response = await client.embeddings.create({
    model: process.env.KNOWLEDGE_BASE_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
    input: text,
    dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
  });

  const embedding = response.data[0]?.embedding;
  if (!embedding || embedding.length !== KNOWLEDGE_EMBEDDING_DIMENSIONS) {
    return buildDeterministicEmbedding(text);
  }
  return normalize(embedding);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  if (!magA || !magB) {
    return 0;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function embeddingToVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
