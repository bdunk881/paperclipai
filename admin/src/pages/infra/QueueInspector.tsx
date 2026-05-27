import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchQueueDetail,
  listInspectorQueues,
  listJobs,
  type JobState,
  type QueueDetail,
} from "../../api/queuesApi";
import type { FlyMachine } from "../../api/infraApi";
import { QueueListRail } from "../../components/queues/QueueListRail";
import { QueueCounterTiles } from "../../components/queues/QueueCounterTiles";
import { ThroughputSparkline } from "../../components/queues/ThroughputSparkline";
import { JobsTable } from "../../components/queues/JobsTable";
import { JobInspectorModal } from "../../components/queues/JobInspectorModal";
import { WorkerCard } from "../../components/queues/WorkerCard";
import { AskAgentButton } from "../../components/agent/AskAgentButton";

export interface QueueInspectorProps {
  /** Optional Fly machines list so worker cards can correlate to the host machine. */
  flyMachines?: FlyMachine[];
}

export function QueueInspector({ flyMachines = [] }: QueueInspectorProps) {
  const queuesQ = useQuery({
    queryKey: ["queue-inspector", "list"],
    queryFn: listInspectorQueues,
    refetchInterval: 10_000,
  });

  const queues = queuesQ.data ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const effectiveSelected = useMemo(() => {
    if (selected && queues.some((q) => q.name === selected)) return selected;
    return queues.find((q) => q.available)?.name ?? null;
  }, [queues, selected]);

  const [state, setState] = useState<JobState>("waiting");
  const [search, setSearch] = useState("");
  const [start, setStart] = useState(0);
  const [openJobId, setOpenJobId] = useState<string | null>(null);

  useEffect(() => {
    setStart(0);
  }, [effectiveSelected, state]);

  const detailQ = useQuery<QueueDetail | null>({
    queryKey: ["queue-inspector", "detail", effectiveSelected],
    queryFn: () => (effectiveSelected ? fetchQueueDetail(effectiveSelected) : Promise.resolve(null)),
    enabled: !!effectiveSelected,
    refetchInterval: 10_000,
  });

  const jobsQ = useQuery({
    queryKey: ["queue-inspector", "jobs", effectiveSelected, state, start, search],
    queryFn: () =>
      effectiveSelected
        ? listJobs(effectiveSelected, { state, start, pageSize: 25, q: search })
        : Promise.resolve(null),
    enabled: !!effectiveSelected,
    refetchInterval: 10_000,
  });

  const detail = detailQ.data ?? null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: "1rem" }}>
      <div>
        <QueueListRail
          queues={queues}
          selected={effectiveSelected ?? ""}
          onSelect={(name) => {
            setSelected(name);
            setOpenJobId(null);
          }}
        />
      </div>

      <div>
        {!effectiveSelected ? (
          <p className="muted">No queues available (Redis not configured?).</p>
        ) : !detail ? (
          <p className="muted">Loading queue…</p>
        ) : (
          <>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <h2 style={{ margin: 0 }}>{detail.name}</h2>
              <AskAgentButton
                context={{
                  kind: "queue_state",
                  source: "admin.infra.compute.queue-inspector",
                  subjectRef: { queue: detail.name },
                  payload: { counters: detail.counters, workers: detail.workers },
                  defaultQuestion: `What does the current state of ${detail.name} suggest?`,
                }}
                label="Ask agent about this queue"
              />
            </div>

            <div style={{ marginBottom: "0.75rem" }}>
              <QueueCounterTiles counters={detail.counters} />
            </div>

            <div style={{ marginBottom: "0.75rem" }}>
              <ThroughputSparkline
                completed={detail.throughput.completed_per_minute}
                failed={detail.throughput.failed_per_minute}
                windowMinutes={detail.throughput.window_minutes}
              />
            </div>

            <div className="card" style={{ marginBottom: 0 }}>
              <h3 style={{ marginTop: 0 }}>Jobs</h3>
              <JobsTable
                jobs={jobsQ.data?.jobs ?? []}
                state={state}
                onStateChange={setState}
                search={search}
                onSearchChange={(q) => {
                  setSearch(q);
                  setStart(0);
                }}
                loading={jobsQ.isFetching}
                onSelect={setOpenJobId}
                start={start}
                pageSize={25}
                onPageChange={setStart}
              />
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>
                Workers <span className="muted" style={{ fontSize: "0.85rem" }}>({detail.workers.length})</span>
              </h3>
              {detail.workers.length === 0 ? (
                <p className="muted">No workers currently connected.</p>
              ) : (
                <div style={{ display: "grid", gap: "0.5rem" }}>
                  {detail.workers.map((w, i) => (
                    <WorkerCard key={`${w.name ?? "x"}-${i}`} worker={w} flyMachines={flyMachines} />
                  ))}
                </div>
              )}
            </div>

            <div className="muted" style={{ fontSize: "0.78rem", marginTop: "0.5rem" }}>
              Pause · Resume · Drain · Retry-all-failed land in PR #6.
            </div>
          </>
        )}
      </div>

      {effectiveSelected && (
        <JobInspectorModal
          queueName={effectiveSelected}
          jobId={openJobId}
          onClose={() => setOpenJobId(null)}
        />
      )}
    </div>
  );
}
