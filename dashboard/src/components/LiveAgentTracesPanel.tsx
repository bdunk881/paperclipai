import { useCallback, useEffect, useState } from "react";
import { listRunsByStatus } from "../api/runsApi";
import { useAgentTraceStream } from "../hooks/useAgentTraceStream";
import { AgentTraceTimeline } from "./AgentTraceTimeline";
import { useAuth } from "../context/AuthContext";

const POLL_MS = 5_000;

function RunTraceCard({ runId, label }: { runId: string; label: string }) {
  const events = useAgentTraceStream(runId);
  return (
    <div className="af2-card p-4">
      <div className="font-ui text-sm font-medium text-ink mb-2">{label}</div>
      <AgentTraceTimeline events={events} compact />
    </div>
  );
}

/**
 * Live tab supplement: streams LLM trace events for in-flight agent runs.
 */
export function LiveAgentTracesPanel() {
  const { accessMode, requireAccessToken } = useAuth();
  const [running, setRunning] = useState<Array<{ id: string; label: string }>>([]);

  const load = useCallback(async () => {
    if (accessMode === "preview") {
      setRunning([]);
      return;
    }
    try {
      const token = await requireAccessToken();
      const { runs } = await listRunsByStatus(token, "running");
      setRunning(
        runs.slice(0, 5).map((r) => ({
          id: r.id,
          label: r.templateName ? `${r.templateName} · ${r.id.slice(0, 8)}` : r.id.slice(0, 8),
        })),
      );
    } catch {
      setRunning([]);
    }
  }, [accessMode, requireAccessToken]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  if (running.length === 0) return null;

  return (
    <section className="mb-6 space-y-3">
      <h2 className="font-ui text-sm font-semibold text-ink">Live agent traces</h2>
      {running.map((run) => (
        <RunTraceCard key={run.id} runId={run.id} label={run.label} />
      ))}
    </section>
  );
}
