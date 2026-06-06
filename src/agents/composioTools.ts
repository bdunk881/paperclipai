/**
 * Native Composio tools for the agent runtime (HEL-755 / P3b).
 *
 * Builds AgentTools from the workspace's CONNECTED Composio toolkits so an agent
 * can call them via normal function-calling. Each tool is named
 * `integration:<toolkit>:<slug>` so the existing per-agent permission filter
 * (agentToolPermissions) gates it by the agent's `allowed_integration_slugs` —
 * no new permission system.
 *
 * Governance posture (HEL-754): HIGH-RISK writes — a slug that maps to an
 * approval tier (pay / sign / merge / publish / message) — are deliberately NOT
 * exposed as autonomous agent tools. Those must run through a governed workflow
 * (the engine `composio.execute` action, which is approval-gated). Agents get
 * reads + benign writes here; a policy-aware "auto_approve → expose it to the
 * agent too" nuance is a follow-up.
 *
 * Flag-gated + best-effort: returns [] when Composio is disabled or nothing is
 * connected, and skips a toolkit whose tool list can't be fetched — a broker
 * hiccup never breaks an agent run. Tool DEFINITIONS are cached per toolkit (TTL)
 * so an agent turn doesn't hit Composio once per connected toolkit every time;
 * the AgentTools themselves are rebuilt per-workspace each call (their handlers
 * close over the caller's workspace, so caching the built tools would leak
 * tenancy — we cache only the tenant-agnostic raw defs).
 */
import type { AgentTool } from "../engine/llmProviders/types";
import { isComposioEnabled } from "../integrations/composio/broker/config";
import {
  connectedAccountStore,
  type ComposioWorkspaceContext,
} from "../integrations/composio/broker/connectedAccountStore";
import {
  executeComposioTool,
  listComposioToolsForToolkit,
} from "../integrations/composio/broker/toolExecution";
import { composioTierFromSlug } from "../approvals/policyTypes";

/** The fields we read off a raw Composio tool (tools.getRawComposioTools). */
interface RawComposioTool {
  slug?: unknown;
  description?: unknown;
  inputParameters?: unknown;
}

const DEFAULT_PER_TOOLKIT_LIMIT = 30;
const TOOL_DEF_TTL_MS = 60 * 60 * 1000; // tool schemas change rarely — refresh hourly
const PERMISSIVE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {},
  additionalProperties: true,
};

// allowlist: process-local TTL cache of Composio raw tool DEFS per toolkit — these
// are global tool schemas (not tenant data); AgentTools are rebuilt per-workspace.
const rawToolCache = new Map<string, { raw: unknown[]; fetchedAt: number }>();

export interface LoadComposioAgentToolsInput {
  workspaceId: string;
  userId: string;
  /** Max tools fetched per connected toolkit (keeps the model's tool list bounded). */
  perToolkitLimit?: number;
}

async function getRawToolsCached(toolkit: string, limit: number): Promise<unknown[]> {
  const key = `${toolkit}:${limit}`;
  const hit = rawToolCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < TOOL_DEF_TTL_MS) {
    return hit.raw;
  }
  const raw = await listComposioToolsForToolkit({ toolkit, limit });
  rawToolCache.set(key, { raw, fetchedAt: Date.now() });
  return raw;
}

/**
 * Build the agent-facing Composio tool list for a workspace: one AgentTool per
 * (non-high-risk) tool of each ACTIVE connected toolkit.
 */
export async function loadComposioAgentTools(
  input: LoadComposioAgentToolsInput,
): Promise<AgentTool[]> {
  if (!isComposioEnabled()) return [];

  const ctx: ComposioWorkspaceContext = { workspaceId: input.workspaceId, userId: input.userId };
  let connected;
  try {
    connected = await connectedAccountStore.listByWorkspace(ctx);
  } catch {
    return [];
  }

  const toolkits = Array.from(
    new Set(connected.filter((r) => r.status === "ACTIVE").map((r) => r.toolkit)),
  );
  if (toolkits.length === 0) return [];

  const limit = input.perToolkitLimit ?? DEFAULT_PER_TOOLKIT_LIMIT;
  const tools: AgentTool[] = [];
  for (const toolkit of toolkits) {
    let raw: unknown[];
    try {
      raw = await getRawToolsCached(toolkit, limit);
    } catch {
      continue; // best-effort: a broker hiccup on one toolkit drops only its tools
    }
    for (const item of raw) {
      const tool = toAgentTool(toolkit, item, ctx);
      if (tool) tools.push(tool);
    }
  }
  return tools;
}

function toAgentTool(
  toolkit: string,
  raw: unknown,
  ctx: ComposioWorkspaceContext,
): AgentTool | null {
  const r = (raw ?? {}) as RawComposioTool;
  const slug = typeof r.slug === "string" && r.slug ? r.slug : null;
  if (!slug) return null;

  // HEL-754 governance: high-risk writes don't run autonomously — only via a
  // governed workflow. Skip them so they never enter an agent's tool set.
  if (composioTierFromSlug(slug)) return null;

  const description =
    typeof r.description === "string" && r.description ? r.description : `${slug} via ${toolkit}.`;
  const inputSchema =
    r.inputParameters && typeof r.inputParameters === "object"
      ? (r.inputParameters as Record<string, unknown>)
      : { ...PERMISSIVE_SCHEMA };

  return {
    name: `integration:${toolkit}:${slug}`,
    description,
    inputSchema,
    handler: async (args) => {
      const result = await executeComposioTool({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        toolkit,
        slug,
        arguments: args,
      });
      if (!result.successful) {
        return { ok: false, error: result.error ?? `${slug} failed.` };
      }
      return result.data ?? {};
    },
  };
}

/** Test-only: clear the per-toolkit tool-def cache. */
export function resetComposioAgentToolsCacheForTests(): void {
  rawToolCache.clear();
}
