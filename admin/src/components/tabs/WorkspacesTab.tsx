import { apiRequest } from "../../lib/apiClient";
import { ReasonPrompt } from "../ReasonPrompt";

interface Workspace {
  workspace_id: string;
  name: string;
  role: string;
  owner_user_id: string;
  created_at: string;
}

export function WorkspacesTab({
  workspaces,
  onChange,
}: {
  userId: string;
  workspaces: Workspace[];
  onChange: () => void;
}) {
  if (workspaces.length === 0)
    return <div className="card">User is not a member of any workspace.</div>;
  return (
    <div className="card">
      <h2>Workspaces ({workspaces.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Workspace ID</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {workspaces.map((w) => (
            <tr key={w.workspace_id}>
              <td>{w.name}</td>
              <td>
                <span className="pill">{w.role}</span>
              </td>
              <td className="code">{w.workspace_id}</td>
              <td>
                <div className="row">
                  <ReasonPrompt
                    label="Lock"
                    onConfirm={async (reason) => {
                      await apiRequest(`/api/admin-console/workspace-ops/${w.workspace_id}/status`, {
                        method: "PATCH",
                        body: { status: "locked", reason },
                      });
                      onChange();
                    }}
                  />
                  <ReasonPrompt
                    label="Unlock"
                    onConfirm={async (reason) => {
                      await apiRequest(`/api/admin-console/workspace-ops/${w.workspace_id}/status`, {
                        method: "PATCH",
                        body: { status: "active", reason },
                      });
                      onChange();
                    }}
                  />
                  <ReasonPrompt
                    label="Pause spend"
                    onConfirm={async (reason) => {
                      await apiRequest(
                        `/api/admin-console/workspace-ops/${w.workspace_id}/budget-pause`,
                        { method: "POST", body: { reason, pause: true } },
                      );
                      onChange();
                    }}
                  />
                  <ReasonPrompt
                    label="Suspend (2-person)"
                    className="danger"
                    onConfirm={(reason) =>
                      apiRequest(`/api/admin-console/workspace-ops/${w.workspace_id}/suspend`, {
                        method: "POST",
                        body: { reason },
                      })
                    }
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
