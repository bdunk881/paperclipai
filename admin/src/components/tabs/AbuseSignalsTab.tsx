import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../lib/apiClient";

interface Signals {
  password_spray_5m: boolean;
  new_device_24h: boolean;
  new_geo_7d: string | null;
}

interface FailedLogin {
  id: string;
  ip: string | null;
  user_agent: string | null;
  country: string | null;
  reason: string | null;
  occurred_at: string;
}

interface Device {
  user_agent_hash: string;
  country: string | null;
  first_seen_at: string;
  last_seen_at: string;
  login_count: number;
}

export function AbuseSignalsTab({ userId }: { userId: string }) {
  const signals = useQuery({
    queryKey: ["signals", userId],
    queryFn: () => apiRequest<Signals>(`/api/admin-console/abuse/user/${userId}/signals`),
  });
  const failed = useQuery({
    queryKey: ["failed-logins", userId],
    queryFn: () =>
      apiRequest<{ rows: FailedLogin[] }>(`/api/admin-console/abuse/user/${userId}/failed-logins`),
  });
  const devices = useQuery({
    queryKey: ["devices", userId],
    queryFn: () =>
      apiRequest<{ rows: Device[] }>(`/api/admin-console/abuse/user/${userId}/devices`),
  });

  return (
    <>
      <div className="card">
        <h2>Signals</h2>
        {signals.isLoading && <div className="muted">Loading…</div>}
        {signals.data && (
          <div className="row">
            {signals.data.password_spray_5m && <span className="pill danger">password-spray (5 min)</span>}
            {signals.data.new_device_24h && <span className="pill warning">new device (24h)</span>}
            {signals.data.new_geo_7d && (
              <span className="pill warning">new geo: {signals.data.new_geo_7d}</span>
            )}
            {!signals.data.password_spray_5m && !signals.data.new_device_24h && !signals.data.new_geo_7d && (
              <span className="muted">No live signals.</span>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Recent failed logins</h2>
        {failed.data?.rows.length === 0 && <div className="muted">None.</div>}
        {failed.data && failed.data.rows.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>IP</th>
                <th>Country</th>
                <th>UA</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {failed.data.rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.occurred_at).toLocaleString()}</td>
                  <td className="code">{r.ip ?? "—"}</td>
                  <td>{r.country ?? "—"}</td>
                  <td className="muted" style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.user_agent ?? "—"}
                  </td>
                  <td>{r.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Devices</h2>
        {devices.data?.rows.length === 0 && <div className="muted">None.</div>}
        {devices.data && devices.data.rows.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>UA hash</th>
                <th>Country</th>
                <th>First seen</th>
                <th>Last seen</th>
                <th>Login count</th>
              </tr>
            </thead>
            <tbody>
              {devices.data.rows.map((d) => (
                <tr key={`${d.user_agent_hash}-${d.country ?? "none"}`}>
                  <td className="code">{d.user_agent_hash.slice(0, 12)}…</td>
                  <td>{d.country ?? "—"}</td>
                  <td>{new Date(d.first_seen_at).toLocaleString()}</td>
                  <td>{new Date(d.last_seen_at).toLocaleString()}</td>
                  <td>{d.login_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
