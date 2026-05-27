import { useQuery } from "@tanstack/react-query";
import { fetchInfraOverview } from "../api/infraApi";
import { StatusPill } from "../components/infra/StatusPill";
import { AskAgentButton } from "../components/agent/AskAgentButton";

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function InfraOverviewPage() {
  const { data, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["infra-overview"],
    queryFn: fetchInfraOverview,
    refetchInterval: 30_000,
  });

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.3rem", margin: 0 }}>Infrastructure · Overview</h1>
        <button onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="banner danger">
          {error instanceof Error ? error.message : "Failed to load overview"}
        </div>
      )}

      <div className="card">
        <h2>Status</h2>
        {isLoading || !data ? (
          <span className="muted">Loading…</span>
        ) : (
          <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            {data.pills.map((p) => (
              <StatusPill key={p.id} label={p.label} level={p.level} detail={p.detail} />
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Recent infra audit</h2>
          {data && data.recent_audit.length > 0 && (
            <AskAgentButton
              context={{
                kind: "audit_event",
                source: "admin.infra.overview",
                payload: { rows: data.recent_audit.slice(0, 5) },
                defaultQuestion: "Look at these recent infra audit rows — is there anything concerning?",
              }}
              label="Ask agent about these"
            />
          )}
        </div>
        {!data || data.recent_audit.length === 0 ? (
          <p className="muted">No recent infra audit entries.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Admin</th>
                <th>Reason</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.recent_audit.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.occurred_at)}</td>
                  <td>
                    <span className="pill">{row.action}</span>
                  </td>
                  <td className="code">{row.admin_user_id.slice(0, 8)}…</td>
                  <td>{row.reason || <span className="muted">—</span>}</td>
                  <td>
                    <AskAgentButton
                      context={{
                        kind: "audit_event",
                        source: "admin.infra.overview",
                        subjectRef: { audit_id: row.id, action: row.action },
                        payload: row.payload,
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
