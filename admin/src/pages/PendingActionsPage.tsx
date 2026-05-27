import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/apiClient";
import { ReasonPrompt } from "../components/ReasonPrompt";

interface PendingAction {
  id: string;
  action: string;
  requested_by_user_id: string;
  reason: string;
  target_user_id: string | null;
  target_workspace_id: string | null;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
  expires_at: string;
}

export function PendingActionsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["pending-actions"],
    queryFn: () => apiRequest<{ actions: PendingAction[] }>(`/api/admin-console/pending-actions`),
    refetchInterval: 5000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["pending-actions"] });

  return (
    <div className="card">
      <h2>Pending two-person actions</h2>
      <p className="muted">
        These actions were queued by another admin and need confirmation. You CANNOT confirm an action you
        queued yourself — the two-person rule is enforced server-side.
      </p>
      {isLoading && <div className="muted">Loading…</div>}
      {data?.actions.length === 0 && <div className="muted">Nothing pending.</div>}
      {data && data.actions.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>Requested by</th>
              <th>Target</th>
              <th>Reason</th>
              <th>Expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.actions.map((a) => (
              <tr key={a.id}>
                <td className="code">{a.action}</td>
                <td className="code">{a.requested_by_user_id.slice(0, 8)}…</td>
                <td className="code">
                  {a.target_user_id?.slice(0, 8) ?? a.target_workspace_id?.slice(0, 8) ?? "—"}
                </td>
                <td>{a.reason}</td>
                <td>{new Date(a.expires_at).toLocaleString()}</td>
                <td>
                  <div className="row">
                    <button
                      className="primary"
                      onClick={async () => {
                        await apiRequest(`/api/admin-console/pending-actions/${a.id}/confirm`, {
                          method: "POST",
                        });
                        refresh();
                      }}
                    >
                      Confirm
                    </button>
                    <ReasonPrompt
                      label="Cancel"
                      onConfirm={async (reason) => {
                        await apiRequest(`/api/admin-console/pending-actions/${a.id}/cancel`, {
                          method: "POST",
                          body: { reason },
                        });
                        refresh();
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
