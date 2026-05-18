/**
 * save_memory agent tool factory (DASH-22 / HEL-137).
 *
 * Wraps the existing `saveMemory` function in the AgentTool shape so
 * provider tool-loops (today: Anthropic; OpenAI / Mistral / Gemini
 * land later) can invoke it during a free-text agentic turn.
 *
 * The tool is the EXPLICIT memory-write surface — agents have to
 * call it on purpose, with structured arguments. That's why this
 * file is just adaptation; the validation pipeline (length caps,
 * PII scan, layer gating, contradiction supersession, embedding,
 * insert) lives in `saveMemoryTool.ts` and is shared with any
 * non-provider caller.
 *
 * Embedding strategy: we resolve the workspace's embeddings tier
 * lazily inside the handler (`saveMemory` does this for us via
 * `embedFn`). Each save_memory call goes through `tierRouter.invoke`
 * with `mode: "embedding"` so the workspace's BYOK provider /
 * Voyage / hosted embedding is honored.
 */

import type { Pool } from "pg";
import type { AgentTool } from "../engine/llmProviders/types";
import { saveMemory, type SaveMemoryArgs } from "../knowledge/saveMemoryTool";
import type { TierBinding } from "../llmConfig/tierRouter";

/**
 * Default embed function — returns an empty vector. Saves still
 * persist, but ANN retrieval won't surface them until a real
 * embedding caller is wired (matches the existing STUB_EMBED
 * pattern in `reflectionRoutes.ts`). Callers that want retrieval
 * to work supply their own embedFn.
 */
const STUB_EMBED_FN = async (
  _text: string,
  _binding: TierBinding,
): Promise<number[]> => [];

const TOOL_NAME = "save_memory";

const TOOL_DESCRIPTION = `Save a note for your future self and your teammates.

WHEN to call:
- You discovered a non-obvious customer preference or constraint
- You worked out a pattern that took multiple runs to figure out
- You hit a blocker that recurs and has a workaround
- You learned context that would change another agent's decisions

DO NOT call:
- For single-use values from this run (those belong in the run's output)
- For information already in your job description or workspace instructions
- For chitchat or restated user input
- If you're unsure whether it matters in 7 days — skip it

Defaults to layer="episode" which is append-only and TTL'd. Use
"knowledge" or "instruction" only if you have authoritative-write
permission; otherwise the call is rejected and you should re-call
with layer="episode".`;

const INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Short headline (≤ 80 chars). Plain English.",
    },
    content: {
      type: "string",
      description: "The note body (≤ 2000 chars). Describe what + why, not what you did this minute.",
    },
    layer: {
      type: "string",
      enum: ["episode", "knowledge", "instruction"],
      description:
        "Storage layer. Default 'episode'. 'knowledge' = durable fact for retrieval. 'instruction' = workspace-wide rule.",
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
        "Kind tag. For episodes: observation | action_result | reflection. For knowledge: document | synthesized | verified.",
    },
    mission_id: {
      type: "string",
      description: "Optional mission this memory relates to (UUID).",
    },
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
      description: "Sources backing this note. Empty array is fine for first-hand observations.",
    },
    contradicts: {
      type: "array",
      items: { type: "string" },
      description: "When 'knowledge' layer: knowledge_item ids this new note supersedes.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Retrieval tags. Lowercase, hyphenated.",
    },
  },
  required: ["title", "content"],
  additionalProperties: false,
};

export interface CreateSaveMemoryAgentToolInput {
  pool: Pool;
  workspaceId: string;
  agentId: string;
  userId: string;
  /**
   * Whether this agent has been granted authoritative-write
   * permission (knowledge + instruction layers). Default false; the
   * agent gets a clear error when it tries to use those layers
   * without permission and can retry with the default episode layer.
   */
  canWriteAuthoritative?: boolean;
  /**
   * Embed function used by saveMemory's vector-write step. When
   * omitted, a stub that returns `[]` is used — saves still persist,
   * but ANN retrieval won't surface those rows until a real embed
   * caller is wired. Matches the `STUB_EMBED` pattern already in
   * `reflectionRoutes.ts`.
   */
  embedFn?: (text: string, binding: TierBinding) => Promise<number[]>;
}

export function createSaveMemoryAgentTool(
  input: CreateSaveMemoryAgentToolInput,
): AgentTool {
  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    inputSchema: INPUT_SCHEMA,
    handler: async (rawInput) => {
      // We trust the provider tool-loop to have schema-validated the
      // shape, but the model can still emit drift. Coerce + delegate
      // to saveMemory which has its own length / PII / permission
      // gates.
      // The provider tool-loop schema-checks the model's tool_use
      // input against `INPUT_SCHEMA` above, but we still go through
      // `unknown` so TypeScript doesn't think the cast is mistakenly
      // narrowing (required fields could be missing if the model
      // drifts; saveMemory validates again and surfaces a clear
      // error the model can recover from).
      const args = rawInput as unknown as SaveMemoryArgs;
      const result = await saveMemory(args, {
        pool: input.pool,
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        userId: input.userId,
        canWriteAuthoritative: input.canWriteAuthoritative ?? false,
        embedFn: input.embedFn ?? STUB_EMBED_FN,
      });
      // The provider loop serializes the return value into tool_result
      // content; returning the structured shape gives the model a
      // clean cue to keep going (`ok: true, id`) or retry (`ok: false`
      // with a reason it can act on).
      return result;
    },
  };
}

/**
 * Text fragment to splice into the system prompt for agents that
 * have memory-write privileges. Pairs with the tool description
 * above — together they teach the model not just THAT the tool
 * exists but WHEN to reach for it.
 */
export const SAVE_MEMORY_SYSTEM_PROMPT_GUIDANCE = `
MEMORY:

You have a save_memory tool. Use it sparingly. The bar is "would my
future self / a teammate be slightly worse off if this insight
disappeared in 30 days?" — if yes, save it. If no, skip.

Default to layer="episode" (append-only, TTL'd). Don't pick
"knowledge" or "instruction" unless your job description explicitly
gives you authoritative-write permission. The system will reject
unauthorized writes; just retry with layer="episode".

Don't save:
- The full text of what just happened (the activity stream has it)
- Customer messages verbatim (they live in the ticket)
- Acknowledgments, restated input, summaries you can re-derive
`.trim();
