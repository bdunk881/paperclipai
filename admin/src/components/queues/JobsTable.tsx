import type { JobState, JobSummary } from "../../api/queuesApi";

const STATES: JobState[] = ["waiting", "active", "delayed", "failed", "completed", "paused"];

export interface JobsTableProps {
  jobs: JobSummary[];
  state: JobState;
  onStateChange: (state: JobState) => void;
  search: string;
  onSearchChange: (q: string) => void;
  loading: boolean;
  onSelect: (jobId: string) => void;
  start: number;
  pageSize: number;
  onPageChange: (start: number) => void;
}

function shortTimeAgo(ms: number | null | undefined): string {
  if (!ms) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function JobsTable({
  jobs,
  state,
  onStateChange,
  search,
  onSearchChange,
  loading,
  onSelect,
  start,
  pageSize,
  onPageChange,
}: JobsTableProps) {
  return (
    <div>
      <div className="row" style={{ marginBottom: "0.5rem", gap: "0.5rem" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          State
          <select value={state} onChange={(e) => onStateChange(e.target.value as JobState)}>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search id or name"
          style={{ flex: 1, maxWidth: 280 }}
        />
        <div className="row" style={{ marginLeft: "auto", gap: "0.3rem" }}>
          <button onClick={() => onPageChange(Math.max(0, start - pageSize))} disabled={start === 0}>
            ‹
          </button>
          <span className="muted" style={{ minWidth: 80, textAlign: "center" }}>
            {start + 1}–{start + jobs.length}
          </span>
          <button onClick={() => onPageChange(start + pageSize)} disabled={jobs.length < pageSize}>
            ›
          </button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Attempts</th>
            <th>Created</th>
            <th>Finished</th>
            <th>Failed reason</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {loading && jobs.length === 0 ? (
            <tr>
              <td colSpan={7} className="muted">
                Loading…
              </td>
            </tr>
          ) : jobs.length === 0 ? (
            <tr>
              <td colSpan={7} className="muted">
                No jobs in this state.
              </td>
            </tr>
          ) : (
            jobs.map((j) => (
              <tr key={j.id}>
                <td className="code">{j.id}</td>
                <td>{j.name}</td>
                <td>
                  {j.attempts_made}
                  {j.attempts_total !== null ? `/${j.attempts_total}` : ""}
                </td>
                <td>{shortTimeAgo(j.timestamp)}</td>
                <td>{shortTimeAgo(j.finished_on)}</td>
                <td className="muted" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {j.failed_reason ?? ""}
                </td>
                <td>
                  <button onClick={() => onSelect(j.id)}>Inspect</button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
