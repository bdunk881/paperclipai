import { useState } from "react";
import type { AgentTraceEnvelope } from "../api/agentTrace";
import { JsonTreeViewer } from "./JsonTreeViewer";
import { useIsPaidTier } from "../hooks/useIsPaidTier";

interface AgentTraceTimelineProps {
  events: AgentTraceEnvelope[];
  compact?: boolean;
}

const DELEGATE_TOOL_NAME = "delegate_to_subagent";

interface TurnGroup {
  /** Stable turn identifier from the trace publisher. */
  turnId: string;
  /** Agent that owned the turn. */
  agentId: string;
  /** Sequence number of the first event in this group (used for ordering + parent-match). */
  firstSeq: number;
  /** Sequence number of the last event in this group. */
  lastSeq: number;
  /** All envelopes in this turn, in seq order. */
  envelopes: AgentTraceEnvelope[];
}

/**
 * Partitions trace events into turn groups. The lowest first-seq turn
 * is treated as the root; the rest are child turns (delegated agent
 * runs). Each child is matched to whichever parent
 * `delegate_to_subagent` tool call it follows by seq.
 *
 * Returns a flat tree:
 *   - `root` is the primary turn's envelopes (rendered top-level)
 *   - `children` maps a parent tool-call callId to the child TurnGroup
 *     whose first event falls between that call's `tool_call.started`
 *     and `tool_result`/`tool_call.failed` events
 */
function buildTurnTree(events: AgentTraceEnvelope[]): {
  root: TurnGroup | null;
  children: Map<string, TurnGroup>;
  unmatched: TurnGroup[];
} {
  const groups = new Map<string, TurnGroup>();
  for (const env of events) {
    let group = groups.get(env.turnId);
    if (!group) {
      group = {
        turnId: env.turnId,
        agentId: env.agentId,
        firstSeq: env.seq,
        lastSeq: env.seq,
        envelopes: [],
      };
      groups.set(env.turnId, group);
    }
    group.envelopes.push(env);
    if (env.seq < group.firstSeq) group.firstSeq = env.seq;
    if (env.seq > group.lastSeq) group.lastSeq = env.seq;
  }
  const ordered = [...groups.values()].sort((a, b) => a.firstSeq - b.firstSeq);
  const root = ordered[0] ?? null;
  const childGroups = ordered.slice(1);

  const children = new Map<string, TurnGroup>();
  const unmatched: TurnGroup[] = [];
  if (!root) return { root, children, unmatched };

  // Walk the parent's tool calls in seq order. For each
  // `delegate_to_subagent` tool_call.started, find the matching
  // tool_result / tool_call.failed (same callId) — the seq window
  // between them is where any child turn's events fall.
  interface DelegateSpan {
    callId: string;
    startSeq: number;
    endSeq: number;
  }
  const spans: DelegateSpan[] = [];
  let openCallId: string | null = null;
  let openStartSeq = 0;
  for (const env of root.envelopes) {
    const e = env.event as { type: string; name?: string; callId?: string };
    if (e.type === "tool_call.started" && e.name === DELEGATE_TOOL_NAME) {
      openCallId = String(e.callId ?? "");
      openStartSeq = env.seq;
    } else if (
      openCallId &&
      (e.type === "tool_result" || e.type === "tool_call.failed") &&
      String(e.callId ?? "") === openCallId
    ) {
      spans.push({ callId: openCallId, startSeq: openStartSeq, endSeq: env.seq });
      openCallId = null;
    }
  }
  if (openCallId) {
    // Span still open at end of root — extend to infinity so any
    // straggling child events still attach.
    spans.push({ callId: openCallId, startSeq: openStartSeq, endSeq: Number.MAX_SAFE_INTEGER });
  }

  for (const child of childGroups) {
    const owning = spans.find(
      (s) => child.firstSeq > s.startSeq && child.firstSeq < s.endSeq,
    );
    if (owning) {
      children.set(owning.callId, child);
    } else {
      unmatched.push(child);
    }
  }

  return { root, children, unmatched };
}

function labelForEvent(envelope: AgentTraceEnvelope): string {
  const e = envelope.event;
  switch (e.type) {
    case "turn.started":
      return "Turn started";
    case "iteration.started":
      return `Iteration ${String(e.iteration ?? "")}`;
    case "assistant.delta":
      return "Assistant";
    case "reasoning.delta":
      return "Reasoning";
    case "tool_call.started":
      return `Tool call · ${String(e.name ?? "")}`;
    case "tool_call.args.delta":
      return `Tool args · ${String(e.name ?? e.callId ?? "")}`;
    case "tool_call.completed":
      return `Tool ready · ${String(e.name ?? "")}`;
    case "tool_call.failed":
      return `Tool failed · ${String(e.name ?? "")}`;
    case "tool_result":
      return `Tool result · ${String(e.name ?? "")}`;
    case "turn.completed":
      return "Turn completed";
    case "turn.error":
      return "Turn error";
    default:
      return e.type;
  }
}

/**
 * Resolve the row body. When the event has a structured payload (e.g.
 * tool_call.completed arguments), we return both the text rendering AND
 * the raw value so Pro users can flip to a collapsible tree.
 */
function bodyForEvent(
  envelope: AgentTraceEnvelope,
): { text: string; raw?: unknown } | null {
  const e = envelope.event;
  switch (e.type) {
    case "assistant.delta":
      return { text: String(e.accumulated ?? e.delta ?? "") };
    case "reasoning.delta":
      return { text: String(e.accumulated ?? e.delta ?? "") };
    case "tool_call.completed": {
      const args = e.arguments ?? {};
      return { text: JSON.stringify(args, null, 2), raw: args };
    }
    case "tool_result":
      return { text: String(e.outputPreview ?? "") };
    case "turn.completed":
      return { text: String(e.text ?? "") };
    case "turn.error":
      return { text: String(e.message ?? "") };
    case "tool_call.args.delta":
      return { text: String(e.accumulatedJson ?? e.delta ?? "") };
    default:
      return null;
  }
}

/**
 * Renders one envelope's row + body. Pulled out so the parent and the
 * nested child branches share the same row formatting.
 */
function TraceRow({ envelope }: { envelope: AgentTraceEnvelope }) {
  const body = bodyForEvent(envelope);
  const { isPaid } = useIsPaidTier();
  // Tree view is only meaningful when there's a structured payload.
  // Default to the raw <pre> until the user explicitly opens the tree.
  const [view, setView] = useState<"raw" | "tree">("raw");
  const canShowTree = isPaid && body?.raw !== undefined;
  return (
    <li className="rounded border border-ink/10 bg-cream/50 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2 font-ui text-ink/70">
        <span>{labelForEvent(envelope)}</span>
        <div className="flex items-center gap-2">
          {canShowTree && (
            <button
              type="button"
              onClick={() => setView((v) => (v === "tree" ? "raw" : "tree"))}
              className="rounded border border-ink/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/60 transition hover:bg-ink/5"
              aria-pressed={view === "tree"}
            >
              {view === "tree" ? "Raw" : "Tree"}
            </button>
          )}
          <span className="font-mono text-[10px] text-ink/50">
            {new Date(envelope.at).toLocaleTimeString()}
          </span>
        </div>
      </div>
      {body ? (
        canShowTree && view === "tree" ? (
          <div className="mt-1 max-h-32 overflow-auto">
            <JsonTreeViewer value={body.raw} />
          </div>
        ) : (
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-ink/90">
            {body.text.length > 1500 ? `${body.text.slice(0, 1500)}…` : body.text}
          </pre>
        )
      ) : null}
    </li>
  );
}

/**
 * Visible (non-streaming) events from a turn group, in seq order.
 */
function visibleEnvelopes(group: TurnGroup): AgentTraceEnvelope[] {
  return group.envelopes.filter(
    (e) => e.event.type !== "assistant.delta" && e.event.type !== "reasoning.delta",
  );
}

export function AgentTraceTimeline({ events, compact }: AgentTraceTimelineProps) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-ink/60 font-ui">Waiting for live trace events…</p>
    );
  }

  const lastAssistant = [...events]
    .reverse()
    .find((e) => e.event.type === "assistant.delta");
  const lastReasoning = [...events]
    .reverse()
    .find((e) => e.event.type === "reasoning.delta");

  // HEL-221: group events by turnId so delegated subagent calls render
  // as a nested tree under the parent's `delegate_to_subagent` tool
  // call instead of being interleaved into one flat list.
  const tree = buildTurnTree(events);
  const root = tree.root;

  return (
    <div className={`space-y-2 ${compact ? "text-xs" : "text-sm"}`}>
      {lastReasoning ? (
        <details className="rounded border border-plum/30 bg-plum/5 p-2">
          <summary className="cursor-pointer font-ui font-medium text-plum">
            Reasoning
          </summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-ink/80">
            {String(lastReasoning.event.accumulated ?? "")}
          </pre>
        </details>
      ) : null}
      {lastAssistant ? (
        <div className="rounded border border-ink/10 bg-paper p-2">
          <div className="font-ui font-medium text-ink/70 mb-1">Live output</div>
          <pre className="whitespace-pre-wrap font-mono text-ink">
            {String(lastAssistant.event.accumulated ?? "").slice(-2000)}
          </pre>
        </div>
      ) : null}
      <ul className="space-y-1">
        {root
          ? visibleEnvelopes(root).map((envelope) => {
              const e = envelope.event as {
                type: string;
                name?: string;
                callId?: string;
              };
              const isDelegateCompletion =
                (e.type === "tool_call.completed" ||
                  e.type === "tool_result" ||
                  e.type === "tool_call.failed") &&
                e.name === DELEGATE_TOOL_NAME;
              const childGroup = isDelegateCompletion
                ? tree.children.get(String(e.callId ?? ""))
                : undefined;
              return (
                <li key={`${envelope.seq}-${envelope.event.type}`} className="space-y-1">
                  <TraceRow envelope={envelope} />
                  {childGroup && e.type === "tool_call.completed" ? (
                    <SubagentBranch group={childGroup} />
                  ) : null}
                </li>
              );
            })
          : null}
        {tree.unmatched.map((group) => (
          <li key={`unmatched-${group.turnId}`}>
            <SubagentBranch group={group} unmatched />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Renders a subagent's turn as a nested, collapsible branch under the
 * parent's `delegate_to_subagent` tool call. Defaults to expanded so
 * the user sees the live output without an extra click.
 */
function SubagentBranch({
  group,
  unmatched = false,
}: {
  group: TurnGroup;
  unmatched?: boolean;
}) {
  const visible = visibleEnvelopes(group);
  return (
    <details
      open
      data-testid="subagent-branch"
      data-turn-id={group.turnId}
      className="ml-4 border-l-2 border-plum/40 pl-3"
    >
      <summary className="cursor-pointer font-ui font-medium text-plum text-xs">
        ↳ Subagent turn
        {unmatched ? " (unattached)" : ""} · {visible.length} event
        {visible.length === 1 ? "" : "s"}
      </summary>
      <ul className="mt-1 space-y-1">
        {visible.map((envelope) => (
          <li key={`${group.turnId}-${envelope.seq}-${envelope.event.type}`}>
            <TraceRow envelope={envelope} />
          </li>
        ))}
      </ul>
    </details>
  );
}
