import type { QueueWorker } from "../../api/queuesApi";
import type { FlyMachine } from "../../api/infraApi";

export interface WorkerCardProps {
  worker: QueueWorker;
  flyMachines?: FlyMachine[];
}

function formatSeconds(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return "—";
  if (s < 60) return `${s.toFixed(0)}s`;
  if (s < 3600) return `${(s / 60).toFixed(0)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

function correlateFlyMachine(worker: QueueWorker, machines: FlyMachine[]): FlyMachine | undefined {
  // BullMQ Worker.name defaults to a uuid; if you set it to the Fly machine
  // id (recommended), that match is exact. Otherwise we try a fuzzy substring
  // match — neither side is authoritative, so we surface what we can find.
  const wname = (worker.name ?? "").toLowerCase();
  if (!wname) return undefined;
  return machines.find(
    (m) => wname.includes(m.id.toLowerCase()) || (m.instance_id && wname.includes(m.instance_id.toLowerCase())),
  );
}

export function WorkerCard({ worker, flyMachines = [] }: WorkerCardProps) {
  const fly = correlateFlyMachine(worker, flyMachines);
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e6e8eb",
        borderRadius: "8px",
        padding: "0.75rem 1rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
        <strong>{worker.name ?? "(unnamed)"}</strong>
        {fly ? (
          <span className="pill success">Fly · {fly.region}</span>
        ) : (
          <span className="pill">no Fly match</span>
        )}
      </div>
      <div className="muted" style={{ fontSize: "0.82rem", display: "flex", gap: "1rem" }}>
        <span>addr {worker.addr ?? "—"}</span>
        <span>age {formatSeconds(worker.age)}</span>
        <span>idle {formatSeconds(worker.idle)}</span>
        {fly && <span className="code">{fly.id.slice(0, 10)}…</span>}
      </div>
    </div>
  );
}
