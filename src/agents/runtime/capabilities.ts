/**
 * Per-backend capability map. Documents what each agent backend supports
 * natively vs. emulates via shim. Read at runtime when deciding whether a
 * feature is worth surfacing on a given agent (e.g., the dashboard should
 * grey out "skills" for a Mistral-tier agent because Mistral has no native
 * Skills concept and the shim only re-injects the markdown into the system
 * prompt).
 */

import type { AgentBackendName } from "./types";

export interface AgentBackendCapabilities {
  /** Multi-turn tool loop. Always true — every backend supports this. */
  toolLoop: boolean;
  /** First-class subagent delegation (Claude SDK subagents, OpenAI handoffs). */
  nativeSubagents: boolean;
  /** First-class MCP client (the SDK speaks MCP directly). */
  nativeMcp: boolean;
  /** Claude Skills loaded from SKILL.md files. */
  nativeSkills: boolean;
  /** Live trace events emitted by the SDK itself (vs. synthesized from final response). */
  nativeStreamingTrace: boolean;
}

const NATIVE: AgentBackendCapabilities = {
  toolLoop: true,
  nativeSubagents: true,
  nativeMcp: true,
  nativeSkills: true,
  nativeStreamingTrace: true,
};

const OPENAI_NATIVE: AgentBackendCapabilities = {
  toolLoop: true,
  nativeSubagents: true,
  nativeMcp: true,
  nativeSkills: false,
  nativeStreamingTrace: true,
};

const FALLBACK: AgentBackendCapabilities = {
  toolLoop: true,
  nativeSubagents: false,
  nativeMcp: false,
  nativeSkills: false,
  nativeStreamingTrace: false,
};

export const BACKEND_CAPABILITIES: Record<AgentBackendName, AgentBackendCapabilities> = {
  claude_sdk: NATIVE,
  openai_agents: OPENAI_NATIVE,
  fallback: FALLBACK,
};

export function getBackendCapabilities(backend: AgentBackendName): AgentBackendCapabilities {
  return BACKEND_CAPABILITIES[backend];
}

/**
 * Middleware-pipeline support per backend (HEL-621).
 *
 * `toolPhase` covers `beforeToolCall`/`afterToolCall` middleware (budget,
 * audit, tool-result truncation, tool-call-limit, PII-on-tool-IO). Every
 * backend funnels our `AgentTool.handler` through a wrapper we own, so this is
 * always `"full"`.
 *
 * `modelPhase` covers `beforeModelCall`/`afterModelCall` middleware
 * (compaction, model-retry, model-fallback, prompt-caching, model-call-limit).
 * Only the FallbackAgentBackend exposes per-turn model boundaries; the SDK
 * backends own their model↔tool loop and handle the equivalent natively, so
 * model-phase middleware is `"delegated"` there — model-phase middleware
 * should no-op when `getMiddlewareSupport(ctx.backend).modelPhase !== "full"`.
 */
export interface MiddlewareSupport {
  toolPhase: "full";
  modelPhase: "full" | "delegated";
}

const MIDDLEWARE_SUPPORT: Record<AgentBackendName, MiddlewareSupport> = {
  fallback: { toolPhase: "full", modelPhase: "full" },
  claude_sdk: { toolPhase: "full", modelPhase: "delegated" },
  openai_agents: { toolPhase: "full", modelPhase: "delegated" },
};

export function getMiddlewareSupport(backend: AgentBackendName): MiddlewareSupport {
  return MIDDLEWARE_SUPPORT[backend];
}
