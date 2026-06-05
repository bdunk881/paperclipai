/**
 * Agent-runtime middleware contract (HEL-621).
 *
 * Generalises the old two-point `AgentHooks` (preToolUse/postToolUse) into a
 * composable, backend-agnostic pipeline. A middleware participates in any
 * subset of the lifecycle points below; the `MiddlewarePipeline` (./pipeline)
 * composes them as an onion so a single middleware can wrap a model call
 * (retry/fallback), rewrite the message list before a call (compaction), or
 * short-circuit a tool call (budget / HITL).
 *
 * Backend applicability (see ../capabilities `getMiddlewareSupport`):
 *   - Tool-phase hooks (beforeToolCall/afterToolCall) run on EVERY backend —
 *     each one funnels our `AgentTool.handler` through a wrapper we own.
 *   - Model-phase hooks (beforeModelCall/afterModelCall) are wired only on the
 *     FallbackAgentBackend; the SDK backends own their model↔tool loop and
 *     handle compaction/retry natively, so model-phase middleware is a no-op
 *     there (the pipeline simply never calls those hooks on an SDK run).
 */
import type {
  NormalizedMessage,
  NormalizedResponse,
  NormalizedToolCall,
  NormalizedUsage,
} from "../../../llmConfig/adapters/types";
import type { AgentBackendName, AgentRunInput, ResolvedModelBinding } from "../types";

/** The model's reply for one turn — what a model-phase middleware inspects/transforms. */
export type ModelCallResult = NormalizedResponse;

/** A single tool invocation the model requested. */
export type ToolCall = NormalizedToolCall;

/** The normalized result of one tool call, as the model will see it. */
export interface ToolOutcome {
  content: string;
  isError?: boolean;
}

/** Per-run, mutable context threaded through every hook of one agent run. */
export interface AgentRunContext {
  readonly run: AgentRunInput;
  readonly binding: ResolvedModelBinding;
  /** The live conversation. Middleware may read AND rewrite this in place (compaction). */
  messages: NormalizedMessage[];
  /** Cumulative usage so far this run. */
  usage: NormalizedUsage;
  /** Cross-hook scratchpad scoped to this run (e.g. a model-call counter). */
  readonly state: Map<string | symbol, unknown>;
  /** Which backend is executing — lets a middleware no-op where it can't run. */
  readonly backend: AgentBackendName;
}

/**
 * A composable unit of agent-loop behavior. Every method is optional; a
 * middleware implements only the lifecycle points it cares about.
 */
export interface AgentMiddleware {
  readonly name: string;

  /**
   * Wrap one model call. Mutate `ctx.messages` before `next()` to compact
   * history; wrap `next()` in try/catch to retry or fall back. Call `next()`
   * exactly once on the happy path.
   */
  beforeModelCall?(
    ctx: AgentRunContext,
    next: () => Promise<ModelCallResult>,
  ): Promise<ModelCallResult>;

  /** Transform a model result after it returns (no `next` — post-work only). */
  afterModelCall?(
    ctx: AgentRunContext,
    result: ModelCallResult,
  ): ModelCallResult | Promise<ModelCallResult>;

  /**
   * Wrap one tool call. Return a `ToolOutcome` to short-circuit (the handler
   * never runs — this is how budget / HITL veto a call); otherwise return
   * `next()` to proceed.
   */
  beforeToolCall?(
    ctx: AgentRunContext,
    call: ToolCall,
    next: () => Promise<ToolOutcome>,
  ): Promise<ToolOutcome>;

  /** Observe/rewrite a completed tool result (truncation / audit / PII). */
  afterToolCall?(
    ctx: AgentRunContext,
    call: ToolCall,
    outcome: ToolOutcome,
  ): ToolOutcome | Promise<ToolOutcome>;
}
