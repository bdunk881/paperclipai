import { useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest, ApiError } from "../lib/apiClient";

interface UserHit {
  user_id: string;
  display_name: string | null;
  is_platform_admin: boolean;
  email?: string;
  timezone: string;
  created_at: string;
}

interface SearchResponse {
  kind: "user" | "id";
  results?: UserHit[];
  user?: UserHit | null;
  workspace?: {
    workspace_id: string;
    name: string;
    owner_user_id: string;
    status: string;
    created_at: string;
  } | null;
}

export function SearchPage() {
  const [q, setQ] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setData(null);
    try {
      const r = await apiRequest<SearchResponse>("/api/admin-console/lookup/search", {
        query: { q },
      });
      setData(r);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.status}: ${err.message}` : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <h2>Customer search</h2>
        <p className="muted">Search by email, user ID, or workspace ID.</p>
        <form onSubmit={submit} className="row">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="alice@example.com or 8400…"
            style={{ flex: 1 }}
            autoFocus
          />
          <button type="submit" className="primary" disabled={busy || !q.trim()}>
            Search
          </button>
        </form>
        {error && (
          <div className="banner danger" style={{ marginTop: "1rem" }}>
            {error}
          </div>
        )}
      </div>

      {data?.kind === "user" && (data.results?.length ?? 0) > 0 && (
        <div className="card">
          <h2>Match</h2>
          <table>
            <thead>
              <tr>
                <th>User ID</th>
                <th>Name</th>
                <th>Created</th>
                <th>Admin?</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.results!.map((u) => (
                <tr key={u.user_id}>
                  <td className="code">{u.user_id}</td>
                  <td>{u.display_name ?? "—"}</td>
                  <td>{new Date(u.created_at).toLocaleString()}</td>
                  <td>{u.is_platform_admin ? <span className="pill warning">platform admin</span> : ""}</td>
                  <td>
                    <Link to={`/customer/${u.user_id}`}>Open Customer-360 →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.kind === "id" && (
        <>
          {data.user && (
            <div className="card">
              <h2>User match</h2>
              <p>
                <span className="code">{data.user.user_id}</span> — {data.user.email ?? "no email"}
                {" · "}
                <Link to={`/customer/${data.user.user_id}`}>Open Customer-360 →</Link>
              </p>
            </div>
          )}
          {data.workspace && (
            <div className="card">
              <h2>Workspace match</h2>
              <p>
                <strong>{data.workspace.name}</strong> · <span className="code">{data.workspace.workspace_id}</span>
                <br />
                <span className="muted">status: {data.workspace.status}</span>
                <br />
                owner:{" "}
                <Link to={`/customer/${data.workspace.owner_user_id}`}>
                  {data.workspace.owner_user_id}
                </Link>
              </p>
            </div>
          )}
          {!data.user && !data.workspace && <div className="banner">No matches.</div>}
        </>
      )}
    </>
  );
}
