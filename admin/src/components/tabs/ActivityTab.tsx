import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../lib/apiClient";

interface ActivityEvent {
  id: string;
  workspace_id: string;
  kind: string;
  actor: Record<string, unknown>;
  subject: Record<string, unknown>;
  payload: Record<string, unknown>;
  occurred_at: string;
}

export function ActivityTab({ userId }: { userId: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["activity", userId],
    queryFn: () =>
      apiRequest<{ events: ActivityEvent[] }>(`/api/admin-console/lookup/user/${userId}/activity`, {
        query: { limit: 100 },
      }),
  });

  if (isLoading) return <div className="muted">Loading activity…</div>;
  if (isError) return <div className="banner danger">{(error as Error).message}</div>;
  if (!data || data.events.length === 0)
    return <div className="card">No recent activity for this user.</div>;
  return (
    <div className="card">
      <h2>Recent activity</h2>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Kind</th>
            <th>Workspace</th>
            <th>Subject</th>
          </tr>
        </thead>
        <tbody>
          {data.events.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.occurred_at).toLocaleString()}</td>
              <td className="code">{e.kind}</td>
              <td className="code">{e.workspace_id.slice(0, 8)}…</td>
              <td>
                <code style={{ fontSize: ".75rem" }}>{JSON.stringify(e.subject)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
