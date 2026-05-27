import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "../../lib/apiClient";

export function ImpersonationTab({ userId }: { userId: string }) {
  const [reason, setReason] = useState("");
  const [token, setToken] = useState<{ session_id: string; token: string; ends_at: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const active = useQuery({
    queryKey: ["impersonation-active", userId],
    queryFn: () =>
      apiRequest<{ sessions: Array<{ id: string; admin_user_id: string; started_at: string; ends_at: string }> }>(
        `/api/admin-console/impersonation/user/${userId}/active`,
      ),
  });

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiRequest<typeof token>(`/api/admin-console/impersonation/${userId}/start`, {
        method: "POST",
        body: { reason },
      });
      setToken(r);
      active.refetch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const dashboardOrigin =
    String(import.meta.env.VITE_DASHBOARD_ORIGIN ?? "").replace(/\/$/, "") || "https://app.helloautoflow.com";

  return (
    <>
      <div className="card">
        <h2>Start read-only impersonation</h2>
        <p className="muted">
          Mints a 30-minute read-only token. The customer dashboard shows a banner and rejects every non-GET
          request for the lifetime of the session. Every navigation is audited.
        </p>
        <div className="field">
          <label>Reason</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <button className="primary" disabled={busy || !reason.trim()} onClick={start}>
          Start impersonation
        </button>
        {error && (
          <div className="banner danger" style={{ marginTop: "1rem" }}>
            {error}
          </div>
        )}
        {token && (
          <div className="banner" style={{ marginTop: "1rem" }}>
            Session minted. Ends {new Date(token.ends_at).toLocaleString()}.
            <div style={{ marginTop: ".5rem" }}>
              <a
                href={`${dashboardOrigin}/?impersonate=${encodeURIComponent(token.token)}`}
                target="_blank"
                rel="noreferrer"
              >
                Open dashboard as user →
              </a>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Active sessions</h2>
        {active.isLoading && <div className="muted">Loading…</div>}
        {active.data?.sessions?.length === 0 && <div className="muted">No active sessions.</div>}
        {active.data && active.data.sessions.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Admin</th>
                <th>Ends</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {active.data.sessions.map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.started_at).toLocaleString()}</td>
                  <td className="code">{s.admin_user_id}</td>
                  <td>{new Date(s.ends_at).toLocaleString()}</td>
                  <td>
                    <button
                      onClick={async () => {
                        await apiRequest(`/api/admin-console/impersonation/${s.id}/end`, {
                          method: "POST",
                        });
                        active.refetch();
                      }}
                    >
                      End
                    </button>
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
