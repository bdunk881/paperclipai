import { useCallback, useEffect, useState } from "react";

import {
  formatCredits,
  getSpendByRelated,
  type SpendByRelatedRow,
} from "../../api/creditsApi";
import { useAuth } from "../../context/AuthContext";

/**
 * Spend-by-related breakdown card (PR C, Phase 3 analytics).
 *
 * Surfaces which agent / mission / workflow burned the most credits
 * over the trailing N days. Drives:
 *   - Cost attribution ("which automation is most expensive?")
 *   - Customer-side pricing ("am I making money off this agent?")
 *   - Anomaly diagnosis ("which surface caused yesterday's spike?")
 *
 * Window defaults to 30 days; user can flip to 7d or 90d.
 */
export function SpendByRelatedCard() {
  const { requireAccessToken } = useAuth();
  const [rows, setRows] = useState<SpendByRelatedRow[] | null>(null);
  const [windowDays, setWindowDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const result = await getSpendByRelated(token, windowDays);
      setRows(result.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load spend breakdown");
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken, windowDays]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3>Spend by source</h3>
        <select
          value={windowDays}
          onChange={(e) => setWindowDays(Number(e.target.value))}
          style={{ fontSize: 12, padding: 4 }}
          disabled={loading}
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>
      <p className="desc" style={{ marginTop: 4 }}>
        Credits consumed by each agent, mission, or workflow. Helps you
        find your highest-spend automations.
      </p>

      {loading ? (
        <p className="desc" style={{ marginTop: 12 }}>Loading…</p>
      ) : error ? (
        <p className="desc" style={{ marginTop: 12, color: "var(--af2-clay)" }}>{error}</p>
      ) : rows && rows.length > 0 ? (
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid var(--af2-border, rgba(0,0,0,0.12))" }}>
                <th style={{ textAlign: "left", padding: "8px 6px" }}>Source</th>
                <th style={{ textAlign: "right", padding: "8px 6px" }}>Credits</th>
                <th style={{ textAlign: "right", padding: "8px 6px" }}>Cost (USD)</th>
                <th style={{ textAlign: "right", padding: "8px 6px" }}>Calls</th>
                <th style={{ textAlign: "right", padding: "8px 6px" }}>Last call</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={`${row.relatedKind}::${row.relatedId}::${idx}`}
                  style={{ borderBottom: "1px solid var(--af2-border, rgba(0,0,0,0.06))" }}
                >
                  <td style={{ padding: "6px" }}>
                    <div style={{ fontFamily: "var(--af2-mono, monospace)", fontSize: 11 }}>
                      {row.relatedKind}
                    </div>
                    <div className="desc" style={{ fontSize: 11 }}>
                      {row.relatedId || <em>(no id)</em>}
                    </div>
                  </td>
                  <td style={{ textAlign: "right", padding: "6px" }}>
                    {formatCredits(row.creditsConsumed)}
                  </td>
                  <td style={{ textAlign: "right", padding: "6px" }}>
                    ${row.retailUsd.toFixed(2)}
                  </td>
                  <td style={{ textAlign: "right", padding: "6px" }}>{row.callCount}</td>
                  <td style={{ textAlign: "right", padding: "6px", fontSize: 11 }} className="desc">
                    {row.latestCallAt ? new Date(row.latestCallAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="desc" style={{ marginTop: 12 }}>
          No credits-mode consumption in this window yet. Make a hosted-LLM call to see it
          appear here.
        </p>
      )}
    </div>
  );
}
