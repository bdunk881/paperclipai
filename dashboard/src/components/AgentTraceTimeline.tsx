import type { AgentTraceEnvelope } from "../api/agentTrace";

interface AgentTraceTimelineProps {
  events: AgentTraceEnvelope[];
  compact?: boolean;
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

function bodyForEvent(envelope: AgentTraceEnvelope): string | null {
  const e = envelope.event;
  switch (e.type) {
    case "assistant.delta":
      return String(e.accumulated ?? e.delta ?? "");
    case "reasoning.delta":
      return String(e.accumulated ?? e.delta ?? "");
    case "tool_call.completed":
      return JSON.stringify(e.arguments ?? {}, null, 2);
    case "tool_result":
      return String(e.outputPreview ?? "");
    case "turn.completed":
      return String(e.text ?? "");
    case "turn.error":
      return String(e.message ?? "");
    case "tool_call.args.delta":
      return String(e.accumulatedJson ?? e.delta ?? "");
    default:
      return null;
  }
}

export function AgentTraceTimeline({ events, compact }: AgentTraceTimelineProps) {
  const visible = events.filter(
    (e) => e.event.type !== "assistant.delta" && e.event.type !== "reasoning.delta",
  );
  const lastAssistant = [...events]
    .reverse()
    .find((e) => e.event.type === "assistant.delta");
  const lastReasoning = [...events]
    .reverse()
    .find((e) => e.event.type === "reasoning.delta");

  if (events.length === 0) {
    return (
      <p className="text-sm text-ink/60 font-ui">Waiting for live trace events…</p>
    );
  }

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
        {visible.map((envelope) => {
          const body = bodyForEvent(envelope);
          return (
            <li
              key={`${envelope.seq}-${envelope.event.type}`}
              className="rounded border border-ink/10 bg-cream/50 px-2 py-1.5"
            >
              <div className="flex justify-between gap-2 font-ui text-ink/70">
                <span>{labelForEvent(envelope)}</span>
                <span className="font-mono text-[10px] text-ink/50">
                  {new Date(envelope.at).toLocaleTimeString()}
                </span>
              </div>
              {body ? (
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-ink/90">
                  {body.length > 1500 ? `${body.slice(0, 1500)}…` : body}
                </pre>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
