import { useQuery } from "@tanstack/react-query";
import {
  fetchInfraCompute,
  type FlyAppView,
  type FlyMachine,
  type JobRunRow,
  type QueueCounters,
} from "../api/infraApi";
import { MetricCard } from "../components/infra/MetricCard";
import { AskAgentButton } from "../components/agent/AskAgentButton";

function shortTimeAgo(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function MachineRow({ appName, m }: { appName: string; m: FlyMachine }) {
  const stateOk = m.state === "started";
  return (
    <tr>
      <td className="code">{m.id.slice(0, 10)}…</td>
      <td>{m.region}</td>
      <td>
        <span className={`pill ${stateOk ? "success" : "warning"}`}>{m.state}</span>
      </td>
      <td>{m.image_ref?.tag ?? m.image_ref?.digest?.slice(0, 12) ?? "—"}</td>
      <td>{shortTimeAgo(m.updated_at ?? m.created_at ?? null)}</td>
      <td>
        <AskAgentButton
          context={{
            kind: "fly_machine",
            source: "admin.infra.compute",
            subjectRef: { app: appName, machine_id: m.id, state: m.state, region: m.region },
            payload: { machine: m },
          }}
        />
      </td>
    </tr>
  );
}

function FlyApp({ view }: { view: FlyAppView }) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: "0.4rem" }}>
        <strong>{view.appName}</strong>
        <AskAgentButton
          context={{
            kind: "fly_app",
            source: "admin.infra.compute",
            subjectRef: { app: view.appName, machine_count: view.machines.length },
            payload: { app: view.appName, machines: view.machines, error: view.error },
          }}
          label={`Ask agent about ${view.appName}`}
        />
      </div>
      {view.error ? (
        <div className="banner danger">{view.error}</div>
      ) : view.machines.length === 0 ? (
        <p className="muted">No machines.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Machine</th>
              <th>Region</th>
              <th>State</th>
              <th>Image</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {view.machines.map((m) => (
              <MachineRow key={m.id} appName={view.appName} m={m} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function QueueRow({ q }: { q: QueueCounters }) {
  if (!q.available || q.error) {
    return (
      <tr>
        <td><strong>{q.name}</strong></td>
        <td colSpan={6} className="muted">
          {q.error ?? "queue unavailable (Redis not configured)"}
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td><strong>{q.name}</strong></td>
      <td>{q.waiting ?? 0}</td>
      <td>{q.active ?? 0}</td>
      <td>{q.delayed ?? 0}</td>
      <td>
        {(q.failed ?? 0) > 0 ? (
          <span className="pill warning">{q.failed}</span>
        ) : (
          <span>0</span>
        )}
      </td>
      <td>{q.completed ?? 0}</td>
      <td>
        <AskAgentButton
          context={{
            kind: "queue_state",
            source: "admin.infra.compute",
            subjectRef: { queue: q.name },
            payload: { counters: q },
          }}
        />
      </td>
    </tr>
  );
}

function JobOutcomePill({ row }: { row: JobRunRow }) {
  const cls =
    row.outcome === "failure"
      ? "danger"
      : row.outcome === "partial" || row.outcome === "skipped"
        ? "warning"
        : "success";
  return <span className={`pill ${cls}`}>{row.outcome}</span>;
}

export function InfraComputePage() {
  const { data, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["infra-compute"],
    queryFn: fetchInfraCompute,
    refetchInterval: 30_000,
  });

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.3rem", margin: 0 }}>Infrastructure · Compute</h1>
        <button onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="banner danger">
          {error instanceof Error ? error.message : "Failed to load compute view"}
        </div>
      )}

      <div className="card">
        <h2>Fly machines</h2>
        {isLoading || !data ? (
          <span className="muted">Loading…</span>
        ) : (
          data.fly.map((view) => <FlyApp key={view.appName} view={view} />)
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>BullMQ queues</h2>
          {data && (
            <div className="row" style={{ gap: "0.5rem" }}>
              <span className="muted">Custom inspector lands in PR #3.</span>
              <a
                href={data.bullboard_url}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: "0.85rem" }}
              >
                Open bull-board (read-only) ↗
              </a>
            </div>
          )}
        </div>
        {isLoading || !data ? (
          <span className="muted">Loading…</span>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Queue</th>
                <th>Waiting</th>
                <th>Active</th>
                <th>Delayed</th>
                <th>Failed</th>
                <th>Completed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.queues.map((q) => (
                <QueueRow key={q.name} q={q} />
              ))}
            </tbody>
          </table>
        )}
        {data && (
          <div className="row" style={{ marginTop: "0.5rem" }}>
            <MetricCard
              label="Redis"
              value={data.redis.reachable ? "up" : data.redis.configured ? "down" : "n/a"}
              level={
                data.redis.reachable ? "ok" : data.redis.configured ? "error" : "neutral"
              }
              hint={data.redis.configured ? "configured" : "not configured"}
            />
          </div>
        )}
      </div>

      <div className="card">
        <h2>Scheduled jobs · last 10 runs</h2>
        {isLoading || !data ? (
          <span className="muted">Loading…</span>
        ) : (
          Object.entries(data.scheduled_jobs).map(([jobName, runs]) => (
            <div key={jobName} style={{ marginBottom: "1rem" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{jobName}</strong>
                <AskAgentButton
                  context={{
                    kind: "scheduled_job",
                    source: "admin.infra.compute",
                    subjectRef: { job: jobName, recent_runs: runs.length },
                    payload: { runs },
                  }}
                />
              </div>
              {runs.length === 0 ? (
                <p className="muted">No runs recorded yet.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Outcome</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id}>
                        <td>{shortTimeAgo(r.started_at)}</td>
                        <td>
                          <JobOutcomePill row={r} />
                        </td>
                        <td className="muted">{r.message ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}
