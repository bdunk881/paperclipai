/**
 * save_memory agent tool (HEL-88).
 *
 * Explicit, structured write path for agent-authored memory. Unlike implicit
 * extraction (the ChatGPT pattern that produces noisy memories), this is a
 * tool the agent has to *call*, with structured arguments and validation
 * gates. Better to forget than to remember noise.
 *
 * Layers it writes to:
 *   - `episode` (default) → `agent_episodes` row
 *   - `knowledge` → `knowledge_items` row (kind: document|synthesized|verified)
 *     Requires the calling agent to have `can_write_authoritative_memory`
 *     granted in `agents.metadata.permissions[]` (default off).
 *   - `instruction` → `workspace_instructions` row, requires same permission
 *
 * Validation pipeline (in order):
 *   1. Length caps (title ≤ 80, content ≤ 2000)
 *   2. PII scan — refuses common patterns; agent re-summarizes
 *   3. Layer gating — non-default layers require explicit permission
 *   4. Contradiction handling — when `contradicts` is set on knowledge, mark
 *      those rows as superseded_by the new row
 *   5. Embedding generation via the tier router (workspace's embeddings tier)
 *   6. Insert + return saved row's id
 */

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { resolveTier, type TierBinding } from "../llmConfig/tierRouter";
import { scanForPii } from "./piiScanner";

const TITLE_MAX = 80;
const CONTENT_MAX = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SaveMemoryLayer = "episode" | "knowledge" | "instruction";

export interface SaveMemoryArgs {
  layer?: SaveMemoryLayer;
  kind?: "observation" | "action_result" | "reflection" | "document" | "synthesized" | "verified";
  title: string;
  content: string;
  mission_id?: string;
  run_id?: string;
  citations?: Array<{ type: "url" | "doc" | "message" | "episode"; ref: string }>;
  contradicts?: string[];
  tags?: string[];
}

export interface SaveMemoryContext {
  pool: Pool;
  workspaceId: string;
  agentId: string;
  /** Caller's auth subject; satisfies RLS `current_setting('autoflow.user_id')`. */
  userId: string;
  /** Used to drive the embedding call. */
  embedFn: (text: string, binding: TierBinding) => Promise<number[]>;
  /** True if the agent has been granted authoritative-write permission. */
  canWriteAuthoritative: boolean;
}

export type SaveMemoryResult =
  | { ok: true; id: string; layer: SaveMemoryLayer; supersededIds: string[] }
  | { ok: false; reason: string; pii?: { kind: string } };

export async function saveMemory(
  args: SaveMemoryArgs,
  ctx: SaveMemoryContext,
): Promise<SaveMemoryResult> {
  // 1. Length caps
  if (typeof args.title !== "string" || !args.title.trim()) {
    return { ok: false, reason: "title is required" };
  }
  if (typeof args.content !== "string" || !args.content.trim()) {
    return { ok: false, reason: "content is required" };
  }
  if (args.title.length > TITLE_MAX) {
    return { ok: false, reason: `title must be ≤ ${TITLE_MAX} chars; summarize and retry` };
  }
  if (args.content.length > CONTENT_MAX) {
    return { ok: false, reason: `content must be ≤ ${CONTENT_MAX} chars; summarize and retry` };
  }

  // 2. PII scan
  const pii = scanForPii(args.title + "\n" + args.content);
  if (pii) {
    return {
      ok: false,
      reason: `Refusing to store ${pii.kind}. Re-summarize without sensitive identifiers.`,
      pii: { kind: pii.kind },
    };
  }

  // 3. Layer gating
  const layer: SaveMemoryLayer = args.layer ?? "episode";
  if (layer !== "episode" && !ctx.canWriteAuthoritative) {
    return {
      ok: false,
      reason: `Agent does not have permission to write to the "${layer}" layer. Use layer="episode" (default).`,
    };
  }

  // 4. Embedding via the workspace's embeddings tier
  const tier = await resolveTier({
    workspaceId: ctx.workspaceId,
    tier: "embeddings",
    agentId: ctx.agentId,
  });
  if (!tier) {
    return {
      ok: false,
      reason:
        "Workspace has no embeddings tier configured. Set workspaces.tier_routing.embeddings or connect a BYOK provider that supports embeddings.",
    };
  }
  let embedding: number[];
  try {
    embedding = await ctx.embedFn(args.title + "\n\n" + args.content, tier.binding);
  } catch (err) {
    return {
      ok: false,
      reason: `Embedding generation failed: ${(err as Error).message}`,
    };
  }
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return { ok: false, reason: "Embedding service returned an empty vector" };
  }

  // 5. Insert into the correct table per layer
  const id = randomUUID();
  const embeddingLiteral = `[${embedding.join(",")}]`;
  const supersededIds: string[] = [];
  const contradictsIds = (args.contradicts ?? []).filter((c) => typeof c === "string" && UUID_RE.test(c));
  const tags = (args.tags ?? []).filter((t) => typeof t === "string");
  const missionId = args.mission_id && UUID_RE.test(args.mission_id) ? args.mission_id : null;
  const runId = args.run_id && UUID_RE.test(args.run_id) ? args.run_id : null;

  try {
    await withWorkspaceContext(
      ctx.pool,
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      async (client) => {
        if (layer === "episode") {
          const kind = args.kind ?? "observation";
          if (!["observation", "action_result", "reflection", "escalation"].includes(kind)) {
            throw new Error(`invalid episode kind: ${kind}`);
          }
          await client.query(
            `INSERT INTO agent_episodes
              (id, workspace_id, agent_id, mission_id, run_id, episode_type,
               title, summary, evidence, embedding)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector)`,
            [
              id,
              ctx.workspaceId,
              ctx.agentId,
              missionId,
              runId,
              kind,
              args.title.trim(),
              args.content,
              JSON.stringify({
                citations: args.citations ?? [],
                tags,
              }),
              embeddingLiteral,
            ],
          );
        } else if (layer === "knowledge") {
          const kind = args.kind ?? "synthesized";
          if (!["document", "synthesized", "verified"].includes(kind)) {
            throw new Error(`invalid knowledge kind for agent write: ${kind}`);
          }
          await client.query(
            `INSERT INTO knowledge_items
              (id, workspace_id, scope, kind, title, content, tags, metadata,
               source_type, mission_id, author_agent_id, embedding)
             VALUES ($1, $2, 'workspace', $3, $4, $5, $6, $7, 'agent-saved', $8, $9, $10::vector)`,
            [
              id,
              ctx.workspaceId,
              kind,
              args.title.trim(),
              args.content,
              tags,
              JSON.stringify({ citations: args.citations ?? [] }),
              missionId,
              ctx.agentId,
              embeddingLiteral,
            ],
          );

          // 6. Contradictions — only meaningful for knowledge writes
          if (contradictsIds.length > 0) {
            const supersededResult = await client.query<{ id: string }>(
              `UPDATE knowledge_items
                  SET superseded_by = $1, updated_at = now()
                WHERE id = ANY($2::uuid[])
                RETURNING id`,
              [id, contradictsIds],
            );
            for (const r of supersededResult.rows) supersededIds.push(r.id);
          }
        } else if (layer === "instruction") {
          await client.query(
            `INSERT INTO workspace_instructions
              (id, workspace_id, mission_id, kind, title, body, version, agent_id)
             VALUES ($1, $2, $3, 'instruction', $4, $5, 1, $6)`,
            [id, ctx.workspaceId, missionId, args.title.trim(), args.content, ctx.agentId],
          );
        }
      },
    );
  } catch (err) {
    return { ok: false, reason: `Save failed: ${(err as Error).message}` };
  }

  return { ok: true, id, layer, supersededIds };
}

// ---------------------------------------------------------------------------
// ToolSpec — universal schema across providers, consumed by provider adapters
// from HEL-82. Agent authors register this once; the adapter translates per
// provider wire format at invocation time.
// ---------------------------------------------------------------------------

export const SAVE_MEMORY_TOOL_NAME = "save_memory";

export const SAVE_MEMORY_TOOL_SPEC = {
  name: SAVE_MEMORY_TOOL_NAME,
  description:
    "Save an observation, action result, reflection, or document insight to long-term workspace memory. " +
    "Other agents in the workspace will see this on future retrieval. " +
    "Use sparingly — better to forget than to remember noise. " +
    "Default layer is 'episode'. The 'knowledge' and 'instruction' layers require explicit grant.",
  parameters: {
    type: "object",
    properties: {
      layer: {
        type: "string",
        enum: ["episode", "knowledge", "instruction"],
        description: "Which memory layer to write to. Default: episode.",
      },
      kind: {
        type: "string",
        enum: [
          "observation",
          "action_result",
          "reflection",
          "document",
          "synthesized",
          "verified",
        ],
        description:
          "Type of memory. For layer=episode: observation|action_result|reflection. " +
          "For layer=knowledge: document|synthesized|verified.",
      },
      title: { type: "string", maxLength: TITLE_MAX, description: "One-line summary, max 80 chars." },
      content: {
        type: "string",
        maxLength: CONTENT_MAX,
        description: "Full memory content, max 2000 chars. Be concise — summarize, don't dump.",
      },
      mission_id: { type: "string", description: "Optional mission UUID to tag this memory with." },
      run_id: { type: "string", description: "Optional run UUID for episodes from a specific run." },
      citations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["url", "doc", "message", "episode"] },
            ref: { type: "string" },
          },
          required: ["type", "ref"],
        },
        description: "Optional list of source references the agent based this memory on.",
      },
      contradicts: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional list of knowledge_item UUIDs this new memory replaces. " +
          "Only meaningful when layer=knowledge.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Optional tags for filtering.",
      },
    },
    required: ["title", "content"],
    additionalProperties: false,
  },
} as const;

// ---------------------------------------------------------------------------
// Test-only helpers (HEL-88 unit tests use these to bypass DB)
// ---------------------------------------------------------------------------

export interface SaveMemoryClientStub {
  query: PoolClient["query"];
}

export const __internal = {
  TITLE_MAX,
  CONTENT_MAX,
  UUID_RE,
};
