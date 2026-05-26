/**
 * Agent runtime contract — the layer that sits above provider adapters and
 * runs an autonomous, multi-turn, tool-using agent loop.
 *
 * Three backends implement this interface:
 *   - ClaudeSdkBackend         uses @anthropic-ai/claude-agent-sdk
 *   - OpenAIAgentsBackend      uses @openai/agents
 *   - FallbackAgentBackend     hand-rolled loop on top of NormalizedRequest
 *
 * Callers (runAgentTurn, executeAgentPrompt) talk to `runAgent()` and never
 * touch a backend directly. `runAgent` picks the backend based on the
 * tier-resolved provider name.
 */
import type { Pool } from "pg";
import type { AgentTool, LLMResponse, ProviderName } from "../../engine/llmProviders/types";
import type { AgentTraceCallback } from "../../engine/agentTrace/types";

export type AgentRunTier = "lite" | "standard" | "power";

/** A subordinate agent that can be delegated to via `delegate_to_subagent`. */
export interface SubagentRef {
  agentId: string;
  name: string;
  roleKey: string;
  /** One-line description the parent agent reads when choosing whether to delegate. */
  description: string;
}

/** An MCP server the agent should be able to call tools on for the duration of the run. */
export interface AgentMcpServer {
  name: string;
  /** HTTP/HTTPS URL of the MCP server. */
  url: string;
  /** Optional bearer token forwarded to the MCP server. */
  authorization?: string;
}

/** Optional pre/post-tool hook the backend calls before/after each tool invocation. */
export interface AgentHooks {
  /**
   * Called before a tool invocation. Returning `{ continue: false, reason }`
   * blocks the call and surfaces the reason to the model as a tool error.
   */
  preToolUse?: (input: {
    toolName: string;
    toolInput: Record<string, unknown>;
  }) => Promise<{ continue: boolean; reason?: string } | void> | { continue: boolean; reason?: string } | void;
  /** Called after a tool completes — used for spend accounting + audit log. */
  postToolUse?: (input: {
    toolName: string;
    toolInput: Record<string, unknown>;
    result: unknown;
    error?: string;
  }) => Promise<void> | void;
}

/** Permission mode for the agent run — maps onto the Claude Agent SDK's permission system. */
export type AgentPermissionMode = "auto" | "plan" | "review";

export interface AgentRunInput {
  pool: Pool;
  workspaceId: string;
  userId: string;
  agentId: string;
  /** Correlates live-trace SSE + persistence (from `runs.id`). */
  runId?: string;
  agentName: string;
  agentRoleKey?: string | null;
  systemPrompt: string;
  userPrompt: string;
  tier?: AgentRunTier;
  /** Caller-supplied tools (memory tool, integration handlers, etc). */
  tools?: AgentTool[];
  /** Agents this agent can delegate to. */
  subagents?: SubagentRef[];
  /** MCP servers to expose as tool sources during this run. */
  mcpServers?: AgentMcpServer[];
  /** Stored agent skill keys (mapped to SKILL.md files when the backend supports skills). */
  skills?: string[];
  maxToolIterations?: number;
  requestTimeoutMs?: number;
  /** Live trace callback — same shape as the rest of the platform expects. */
  onTrace?: AgentTraceCallback;
  /**
   * Permission mode for the run:
   *   - "auto"   default; the agent executes tools without prompting
   *   - "plan"   agent produces a plan and stops (Claude SDK plan mode)
   *   - "review" agent runs but every tool call is forwarded to hooks for approval
   */
  permissionMode?: AgentPermissionMode;
  /** Pre/post tool hooks. Used today for budget enforcement + audit logging. */
  hooks?: AgentHooks;
}

export interface AgentRunResult {
  text: string;
  usage: NonNullable<LLMResponse["usage"]>;
  provider: ProviderName;
  model: string;
  /** Name of the backend that ran the loop — for logging/observability. */
  backend: AgentBackendName;
}

export type AgentBackendName = "claude_sdk" | "openai_agents" | "fallback";

/** Concrete provider+credential bundle a backend needs. The runtime resolves these from tierRouter. */
export interface ResolvedModelBinding {
  provider: ProviderName;
  model: string;
  apiKey: string;
  /** Free-form provider options forwarded to the SDK (region, projectId, etc.). */
  providerOptions?: Record<string, unknown>;
}

export interface AgentBackend {
  readonly name: AgentBackendName;
  run(input: AgentRunInput, binding: ResolvedModelBinding): Promise<AgentRunResult>;
}
