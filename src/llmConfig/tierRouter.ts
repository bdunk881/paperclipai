/**
 * Tier routing — the cross-cutting abstraction that lets the rest of the
 * platform reference logical tiers (small/medium/large/embeddings/vision)
 * without ever hardcoding a specific provider or model.
 *
 * Why this exists (HEL-81):
 *   AutoFlow is BYOK + multi-provider. Some customers run all-Anthropic
 *   (Haiku/Sonnet/Opus). Some all-OpenAI (nano/4.1/5). Some mixed. Some on
 *   Gemini or Mistral. The platform shouldn't say "use Haiku for triage" —
 *   it should say "use the small tier for triage" and let each workspace
 *   resolve `small` to whatever they've configured.
 *
 * What this module does:
 *   - Stores the workspace's `tier_routing` JSONB (per migration 033).
 *   - Resolves a logical tier → concrete { provider, model, credentialId? }.
 *   - Falls back to AutoFlow defaults inferred from connected BYOK keys when
 *     a workspace hasn't customized its matrix.
 *   - Handles per-agent overrides via `agents.tier_overrides`.
 *   - Provides `invoke()` and `getProviderModel()` entry points for callers.
 *     The actual provider invocation lands in HEL-82 (provider adapters);
 *     this module exposes only the resolution step in v1.
 */

import type { ProviderName } from "../engine/llmProviders/types";
import { inMemoryAllowed, isPostgresConfigured, queryPostgres } from "../db/postgres";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const TIER_KEYS = ["small", "medium", "large", "embeddings", "vision"] as const;
export type TierKey = (typeof TIER_KEYS)[number];

/** A single tier binding — what model on what provider, with optional credential pinning. */
export interface TierBinding {
  provider: ProviderName;
  model: string;
  /** UUID of the LLM credential row to use; defaults to workspace's default for the provider. */
  credentialId?: string;
  /** Optional secondary binding the router falls back to when primary is rate-limited / down. */
  fallback?: {
    provider: ProviderName;
    model: string;
    credentialId?: string;
  };
  /** For `embeddings` tier — pin a specific embedding-model version so re-embeds know to backfill. */
  version?: number;
}

export type TierMatrix = Partial<Record<TierKey, TierBinding>>;

// ---------------------------------------------------------------------------
// Provider catalogs — recommended tier mappings per provider
// ---------------------------------------------------------------------------

/**
 * Per-provider recommended tier defaults. When a workspace hasn't customized
 * its `tier_routing`, the router infers the default matrix from the providers
 * that have at least one connected BYOK credential.
 *
 * Order of preference when multiple providers are connected:
 *   - small      → cheapest small-tier model across connected providers
 *   - medium     → best balance (Sonnet/4.1/Gemini-Pro tier)
 *   - large      → best reasoning (Opus/GPT-5/Gemini-Ultra tier)
 *   - embeddings → OpenAI text-embedding-3-small if available; else Voyage if Anthropic; else provider-native
 *   - vision     → first vision-capable medium-tier model among connected providers
 */
export const PROVIDER_TIER_DEFAULTS: Record<ProviderName, Partial<Record<TierKey, string>>> = {
  anthropic: {
    small: "claude-haiku-4-5-20251001",
    medium: "claude-sonnet-4-6",
    large: "claude-opus-4-6",
    vision: "claude-sonnet-4-6",
  },
  openai: {
    small: "gpt-4o-mini",
    medium: "gpt-4o",
    large: "gpt-4o",
    embeddings: "text-embedding-3-small",
    vision: "gpt-4o",
  },
  gemini: {
    small: "gemini-1.5-flash",
    medium: "gemini-1.5-pro",
    large: "gemini-1.5-pro",
    vision: "gemini-1.5-pro",
  },
  mistral: {
    small: "mistral-small-latest",
    medium: "mistral-large-latest",
    large: "mistral-large-latest",
  },
  bedrock: {
    small: "amazon.nova-micro-v1:0",
    medium: "amazon.nova-lite-v1:0",
    large: "amazon.nova-pro-v1:0",
  },
  "vertex-ai": {},
  groq: {},
  fireworks: {},
  together: {},
  ollama: {},
  localai: {},
  cohere: { embeddings: "embed-english-v3.0" },
  perplexity: {},
  xai: {},
  deepseek: {},
};

/**
 * Relative cost rank per provider for the small tier — used to pick the
 * cheapest "small" when multiple providers are connected. Lower number =
 * cheaper. Not exact $/1M; just a relative ordering.
 */
const SMALL_TIER_COST_RANK: Record<ProviderName, number> = {
  gemini: 1, // 1.5-flash ≈ $0.075/1M in
  openai: 2, // 4o-mini ≈ $0.15/1M in
  mistral: 3, // small ≈ $0.10/1M
  anthropic: 4, // haiku ≈ $1/1M
  groq: 1.5,
  deepseek: 1.2,
  fireworks: 1.8,
  together: 1.8,
  ollama: 0,
  localai: 0,
  bedrock: 3,
  "vertex-ai": 2,
  cohere: 5,
  perplexity: 5,
  xai: 5,
};

// ---------------------------------------------------------------------------
// Default-matrix inference
// ---------------------------------------------------------------------------

/**
 * Given the set of providers a workspace has at least one BYOK credential for,
 * produce the recommended default tier matrix. Used on first BYOK key connect
 * and as the fallback whenever a workspace's `tier_routing` is empty.
 */
export function getDefaultTierMatrix(connectedProviders: ProviderName[]): TierMatrix {
  if (connectedProviders.length === 0) {
    return {};
  }

  const matrix: TierMatrix = {};

  // small — pick the cheapest connected provider
  const cheapestForSmall = pickCheapest("small", connectedProviders);
  if (cheapestForSmall) {
    matrix.small = { provider: cheapestForSmall.provider, model: cheapestForSmall.model };
  }

  // medium — prefer Anthropic Sonnet, then OpenAI 4.x, then Gemini Pro, then Mistral
  const mediumPriority: ProviderName[] = ["anthropic", "openai", "gemini", "mistral"];
  for (const p of mediumPriority) {
    if (connectedProviders.includes(p)) {
      const model = PROVIDER_TIER_DEFAULTS[p]?.medium;
      if (model) {
        matrix.medium = { provider: p, model };
        break;
      }
    }
  }
  // fallback: any connected provider with a `medium` recommendation
  if (!matrix.medium) {
    const fallback = connectedProviders.find((p) => PROVIDER_TIER_DEFAULTS[p]?.medium);
    if (fallback) {
      matrix.medium = { provider: fallback, model: PROVIDER_TIER_DEFAULTS[fallback].medium! };
    }
  }

  // large — prefer Anthropic Opus, then GPT-4o/5, then Gemini Pro
  const largePriority: ProviderName[] = ["anthropic", "openai", "gemini", "mistral"];
  for (const p of largePriority) {
    if (connectedProviders.includes(p)) {
      const model = PROVIDER_TIER_DEFAULTS[p]?.large;
      if (model) {
        matrix.large = { provider: p, model };
        break;
      }
    }
  }

  // embeddings — OpenAI text-embedding-3-small is the de facto baseline; else cohere; else skip
  if (connectedProviders.includes("openai")) {
    matrix.embeddings = {
      provider: "openai",
      model: "text-embedding-3-small",
      version: 1,
    };
  } else if (connectedProviders.includes("cohere")) {
    matrix.embeddings = {
      provider: "cohere",
      model: PROVIDER_TIER_DEFAULTS.cohere.embeddings!,
      version: 1,
    };
  }

  // vision — first connected provider with a vision recommendation
  for (const p of connectedProviders) {
    const model = PROVIDER_TIER_DEFAULTS[p]?.vision;
    if (model) {
      matrix.vision = { provider: p, model };
      break;
    }
  }

  return matrix;
}

function pickCheapest(
  tier: TierKey,
  connectedProviders: ProviderName[],
): { provider: ProviderName; model: string } | null {
  let best: { provider: ProviderName; model: string; rank: number } | null = null;
  for (const provider of connectedProviders) {
    const model = PROVIDER_TIER_DEFAULTS[provider]?.[tier];
    if (!model) continue;
    const rank = SMALL_TIER_COST_RANK[provider] ?? Number.POSITIVE_INFINITY;
    if (!best || rank < best.rank) {
      best = { provider, model, rank };
    }
  }
  return best ? { provider: best.provider, model: best.model } : null;
}

// ---------------------------------------------------------------------------
// In-memory store (dev/test fallback per HEL-80 conventions)
// ---------------------------------------------------------------------------

const inMemoryWorkspaceMatrices = new Map<string, TierMatrix>();
const inMemoryAgentOverrides = new Map<string, TierMatrix>();

// ---------------------------------------------------------------------------
// Persistence — read/write workspace + agent tier bindings
// ---------------------------------------------------------------------------

export async function getWorkspaceTierMatrix(workspaceId: string): Promise<TierMatrix> {
  if (isPostgresConfigured()) {
    const result = await queryPostgres<{ tier_routing: TierMatrix | null }>(
      "SELECT tier_routing FROM workspaces WHERE id = $1",
      [workspaceId],
    );
    if (result.rowCount === 0) return {};
    return result.rows[0].tier_routing ?? {};
  }

  if (inMemoryAllowed()) {
    return inMemoryWorkspaceMatrices.get(workspaceId) ?? {};
  }

  throw new Error(
    "DATABASE_URL is required for tierRouter.getWorkspaceTierMatrix() outside development/test",
  );
}

export async function setWorkspaceTierMatrix(
  workspaceId: string,
  matrix: TierMatrix,
): Promise<void> {
  if (isPostgresConfigured()) {
    await queryPostgres(
      "UPDATE workspaces SET tier_routing = $2, updated_at = now() WHERE id = $1",
      [workspaceId, JSON.stringify(matrix)],
    );
    return;
  }

  if (inMemoryAllowed()) {
    inMemoryWorkspaceMatrices.set(workspaceId, matrix);
    return;
  }

  throw new Error(
    "DATABASE_URL is required for tierRouter.setWorkspaceTierMatrix() outside development/test",
  );
}

export async function getAgentTierOverrides(agentId: string): Promise<TierMatrix> {
  if (isPostgresConfigured()) {
    const result = await queryPostgres<{ tier_overrides: TierMatrix | null }>(
      "SELECT tier_overrides FROM agents WHERE id = $1",
      [agentId],
    );
    if (result.rowCount === 0) return {};
    return result.rows[0].tier_overrides ?? {};
  }

  if (inMemoryAllowed()) {
    return inMemoryAgentOverrides.get(agentId) ?? {};
  }

  throw new Error(
    "DATABASE_URL is required for tierRouter.getAgentTierOverrides() outside development/test",
  );
}

export async function setAgentTierOverrides(
  agentId: string,
  overrides: TierMatrix,
): Promise<void> {
  if (isPostgresConfigured()) {
    await queryPostgres(
      "UPDATE agents SET tier_overrides = $2, updated_at = now() WHERE id = $1",
      [agentId, JSON.stringify(overrides)],
    );
    return;
  }

  if (inMemoryAllowed()) {
    inMemoryAgentOverrides.set(agentId, overrides);
    return;
  }

  throw new Error(
    "DATABASE_URL is required for tierRouter.setAgentTierOverrides() outside development/test",
  );
}

// ---------------------------------------------------------------------------
// Resolution — what concrete provider/model does THIS caller use right now?
// ---------------------------------------------------------------------------

export interface ResolveTierArgs {
  workspaceId: string;
  tier: TierKey;
  /** Optional — when provided, agent-level overrides take precedence over workspace defaults. */
  agentId?: string;
  /** Optional — providers the workspace has connected BYOK credentials for. Used to compute fallback defaults if matrix is empty. */
  connectedProviders?: ProviderName[];
}

export interface ResolveTierResult {
  binding: TierBinding;
  /** Which layer the binding came from. */
  source: "agent_override" | "workspace_matrix" | "inferred_default";
}

/**
 * Look up the concrete provider+model to use for a logical tier.
 *
 * Resolution order:
 *   1. Agent-level override (if agentId provided and agent has one for this tier)
 *   2. Workspace tier_routing matrix
 *   3. Inferred default from connected BYOK providers (if connectedProviders provided)
 *   4. null binding (caller decides what to do — usually a clear error)
 */
export async function resolveTier(args: ResolveTierArgs): Promise<ResolveTierResult | null> {
  if (args.agentId) {
    const overrides = await getAgentTierOverrides(args.agentId);
    const override = overrides[args.tier];
    if (override) {
      return { binding: override, source: "agent_override" };
    }
  }

  const matrix = await getWorkspaceTierMatrix(args.workspaceId);
  const binding = matrix[args.tier];
  if (binding) {
    return { binding, source: "workspace_matrix" };
  }

  if (args.connectedProviders && args.connectedProviders.length > 0) {
    const defaults = getDefaultTierMatrix(args.connectedProviders);
    const inferred = defaults[args.tier];
    if (inferred) {
      return { binding: inferred, source: "inferred_default" };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Test-only helpers
// ---------------------------------------------------------------------------

export function __resetInMemoryStateForTests(): void {
  inMemoryWorkspaceMatrices.clear();
  inMemoryAgentOverrides.clear();
}
