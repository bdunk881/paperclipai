/**
 * compactionMiddleware (HEL-624) — keeps a long-running agent's message history
 * from overflowing the model's context window.
 *
 * The fallback loop appends turns to `ctx.messages` without bound. Before a
 * model call, this `beforeModelCall` middleware checks a char estimate of the
 * transcript; once it crosses a threshold it summarises the OLDER turns into a
 * single message and rewrites `ctx.messages` in place, keeping the original
 * task + the most recent turns verbatim.
 *
 * Fallback-only: only that backend owns the message list (`getMiddlewareSupport`
 * reports `modelPhase: "full"` for it). The SDK backends compact natively, so
 * this no-ops there (and `beforeModelCall` isn't even invoked on those runs).
 *
 * Safety:
 *   - Best-effort — if summarisation throws, the turn proceeds uncompacted
 *     (no worse than today). Never breaks the run.
 *   - The recent tail is cut at an "assistant" boundary so a tool_result is
 *     never separated from its tool_use (which providers reject), and the
 *     task + summary are merged into ONE user message (no consecutive
 *     same-role messages).
 *
 * Gated by AUTOFLOW_AGENT_COMPACTION_ENABLED at the wiring layer (runAgentTurn);
 * default off — the riskiest change in the project, validate before flipping.
 */
import { getProviderAdapter } from "../../../llmConfig/adapters";
import type {
  NormalizedMessage,
  NormalizedRequest,
} from "../../../llmConfig/adapters/types";
import { getMiddlewareSupport } from "../capabilities";
import type { AgentMiddleware, AgentRunContext, ModelCallResult } from "./types";

/** ~30k tokens. Compact when the running transcript exceeds this many chars. */
export const DEFAULT_COMPACTION_THRESHOLD_CHARS = 120_000;
/** Most recent messages kept verbatim; older ones get summarised. */
const DEFAULT_KEEP_RECENT = 6;

const SUMMARY_SYSTEM_PROMPT =
  "You compress an AI agent's working transcript. Produce a terse but complete brief that preserves the goal, decisions made, facts and results discovered from tool calls, and what is still pending. Omit pleasantries. Output only the brief.";

export interface CompactionOptions {
  thresholdChars?: number;
  keepRecentMessages?: number;
  /** Injectable summariser (tests). Default calls the run's model via the adapter. */
  summarize?: (ctx: AgentRunContext, older: NormalizedMessage[]) => Promise<string>;
}

export function compactionMiddleware(options: CompactionOptions = {}): AgentMiddleware {
  const threshold = options.thresholdChars ?? DEFAULT_COMPACTION_THRESHOLD_CHARS;
  const keepRecent = Math.max(2, options.keepRecentMessages ?? DEFAULT_KEEP_RECENT);
  const summarize = options.summarize ?? defaultSummarize;

  return {
    name: "context-compaction",
    async beforeModelCall(ctx, next): Promise<ModelCallResult> {
      if (getMiddlewareSupport(ctx.backend).modelPhase !== "full") return next();
      if (threshold > 0 && estimateChars(ctx.messages) > threshold) {
        try {
          await compact(ctx, keepRecent, summarize);
        } catch (err) {
          console.warn(
            `[compactionMiddleware] compaction skipped: ${(err as Error).message}`,
          );
        }
      }
      return next();
    },
  };
}

/** Rough char count of the transcript (content + tool call args + tool results). */
export function estimateChars(messages: NormalizedMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (m.content) total += m.content.length;
    if (m.toolCalls) {
      for (const c of m.toolCalls) total += c.name.length + JSON.stringify(c.arguments).length;
    }
    if (m.toolResults) {
      for (const r of m.toolResults) total += r.content.length;
    }
  }
  return total;
}

async function compact(
  ctx: AgentRunContext,
  keepRecent: number,
  summarize: (ctx: AgentRunContext, older: NormalizedMessage[]) => Promise<string>,
): Promise<void> {
  const msgs = ctx.messages;
  if (msgs.length <= keepRecent + 1) return;

  // Choose a cut so the recent tail starts at an "assistant" message — never a
  // "tool" message (a tool_result must follow its tool_use) and never mid-turn.
  let cut = msgs.length - keepRecent;
  while (cut < msgs.length && msgs[cut].role !== "assistant") cut++;
  if (cut <= 1 || cut >= msgs.length) return; // nothing safely compactable

  const older = msgs.slice(1, cut);
  if (older.length === 0) return;
  const recent = msgs.slice(cut);

  const summary = await summarize(ctx, older);
  const task = msgs[0].content ?? "";
  // Merge task + summary into ONE user message (no consecutive user messages).
  const merged: NormalizedMessage = {
    role: "user",
    content: `${task}\n\n[Summary of earlier work]\n${summary}`.trim(),
  };
  ctx.messages = [merged, ...recent];
}

async function defaultSummarize(
  ctx: AgentRunContext,
  older: NormalizedMessage[],
): Promise<string> {
  const adapter = getProviderAdapter(ctx.binding.provider);
  const request: NormalizedRequest = {
    provider: ctx.binding.provider,
    model: ctx.binding.model,
    apiKey: ctx.binding.apiKey,
    providerOptions: ctx.binding.providerOptions,
    system: SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: serializeTranscript(older) }],
  };
  const resp = await adapter.invoke(request);
  // Count the summary call against the run's cumulative usage (best-effort).
  ctx.usage.inputTokens += resp.usage.inputTokens;
  ctx.usage.outputTokens += resp.usage.outputTokens;
  if (resp.usage.cachedInputTokens) {
    ctx.usage.cachedInputTokens =
      (ctx.usage.cachedInputTokens ?? 0) + resp.usage.cachedInputTokens;
  }
  return resp.content || "[summary unavailable]";
}

function serializeTranscript(messages: NormalizedMessage[]): string {
  return messages
    .map((m) => {
      if (m.role === "tool") {
        return (m.toolResults ?? []).map((r) => `[tool result] ${r.content}`).join("\n");
      }
      if (m.role === "assistant") {
        const calls = (m.toolCalls ?? [])
          .map((c) => `[tool call] ${c.name}(${JSON.stringify(c.arguments)})`)
          .join("\n");
        return [m.content, calls].filter(Boolean).join("\n");
      }
      return `${m.role}: ${m.content ?? ""}`;
    })
    .filter(Boolean)
    .join("\n\n");
}
