import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "../lib/apiClient";

interface Row {
  id: string;
  admin_user_id: string;
  action: string;
  target_user_id: string | null;
  target_workspace_id: string | null;
  reason: string;
  payload: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
  occurred_at: string;
}

export function AuditLogPage() {
  const [filters, setFilters] = useState({
    admin_user_id: "",
    target_user_id: "",
    target_workspace_id: "",
    action: "",
  });
  const { data, isLoading } = useQuery({
    queryKey: ["audit", filters],
    queryFn: () =>
      apiRequest<{ rows: Row[] }>(`/api/admin-console/audit`, {
        query: {
          admin_user_id: filters.admin_user_id || undefined,
          target_user_id: filters.target_user_id || undefined,
          target_workspace_id: filters.target_workspace_id || undefined,
          action: filters.action || undefined,
          limit: 200,
        },
      }),
  });

  return (
    <>
      <div className="card">
        <h2>Audit log</h2>
        <div className="row">
          <input
            placeholder="admin_user_id"
            value={filters.admin_user_id}
            onChange={(e) => setFilters((f) => ({ ...f, admin_user_id: e.target.value }))}
          />
          <input
            placeholder="target_user_id"
            value={filters.target_user_id}
            onChange={(e) => setFilters((f) => ({ ...f, target_user_id: e.target.value }))}
          />
          <input
            placeholder="target_workspace_id"
            value={filters.target_workspace_id}
            onChange={(e) => setFilters((f) => ({ ...f, target_workspace_id: e.target.value }))}
          />
          <input
            placeholder="action"
            value={filters.action}
            onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
          />
        </div>
      </div>
      <div className="card">
        {isLoading && <div className="muted">Loading…</div>}
        {data && (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Target user</th>
                <th>Target workspace</th>
                <th>Reason</th>
                <th>Payload</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.occurred_at).toLocaleString()}</td>
                  <td className="code">{r.admin_user_id.slice(0, 8)}…</td>
                  <td className="code">{r.action}</td>
                  <td className="code">{r.target_user_id?.slice(0, 8) ?? "—"}</td>
                  <td className="code">{r.target_workspace_id?.slice(0, 8) ?? "—"}</td>
                  <td>{r.reason || "—"}</td>
                  <td>
                    <code style={{ fontSize: ".75rem" }}>{JSON.stringify(r.payload)}</code>
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
