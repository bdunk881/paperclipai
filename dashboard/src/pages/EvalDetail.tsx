/**
 * Eval results (HEL-787) — per-row pass/fail vs expected + an aggregate score.
 *
 * Reads GET /api/evals/:evalId (HEL-776) and polls every 2s until `done` (every
 * run terminal), so scores firm up live as the dry-run batch drains. Each row
 * shows the run status, a pass/fail/pending pill, and expected vs actual with
 * the specific mismatched keys.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getEval, type EvalDetailResponse, type EvalRow } from "../api/evalsApi";
import { ErrorState, LoadingState } from "../components/UiStates";

const MONO: React.CSSProperties = { fontFamily: "var(--af2-mono)", fontSize: 12 };

function passPill(pass: boolean | null): { label: string; bg: string; fg: string } {
  if (pass === null) return { label: "pending", bg: "rgba(107,114,128,0.15)", fg: "#6b7280" };
  if (pass) return { label: "pass", bg: "rgba(22,163,74,0.15)", fg: "#16a34a" };
  return { label: "fail", bg: "rgba(185,28,28,0.15)", fg: "#b91c1c" };
}

function compactJson(value: unknown): string {
  if (value === undefined) return "—";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function StatBlock({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="af2-card" style={{ padding: "10px 14px", minWidth: 92 }}>
      <div style={{ fontSize: 11, color: "var(--af2-ink-soft, #6b7280)" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent ?? "inherit" }}>{value}</div>
    </div>
  );
}

export default function EvalDetail() {
  const { evalId } = useParams<{ evalId: string }>();
  const { requireAccessToken } = useAuth();
  const [detail, setDetail] = useState<EvalDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!evalId) return;
      if (!opts?.silent) setLoading(true);
      try {
        const token = await requireAccessToken();
        setDetail(await getEval(token, evalId));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load eval");
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [evalId, requireAccessToken],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Poll until every run is terminal; stop once the eval is done.
  useEffect(() => {
    if (!detail || detail.done) return;
    const timer = setInterval(() => void load({ silent: true }), 2000);
    return () => clearInterval(timer);
  }, [detail, load]);

  if (loading) {
    return (
      <div className="af2-page text-af2-ink" style={{ maxWidth: 1040 }}>
        <LoadingState label="Loading eval…" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="af2-page text-af2-ink" style={{ maxWidth: 1040 }}>
        <ErrorState
          title="Couldn't load this eval"
          message={error ?? "Eval not found."}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  const { summary } = detail;
  const passRatePct = `${Math.round(summary.passRate * 100)}%`;

  return (
    <div className="af2-page text-af2-ink" style={{ maxWidth: 1040 }}>
      <div className="af2-page-head">
        <div className="af2-eyebrow">
          <Link to="/evals" style={{ color: "var(--af2-clay)", textDecoration: "none" }}>
            Evals
          </Link>{" "}
          · Results
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>{detail.name}</h1>
          {detail.dryRun && (
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 999,
                background: "rgba(107,114,128,0.15)",
                color: "#6b7280",
              }}
            >
              dry run
            </span>
          )}
          <span style={{ fontSize: 12, color: "var(--af2-ink-soft, #6b7280)" }}>
            {detail.done ? "complete" : "running…"}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "12px 0 20px" }}>
        <StatBlock label="Cases" value={String(summary.total)} />
        <StatBlock label="Passed" value={String(summary.passed)} accent="#16a34a" />
        <StatBlock label="Failed" value={String(summary.failed)} accent={summary.failed > 0 ? "#b91c1c" : undefined} />
        <StatBlock label="Pending" value={String(summary.pending)} />
        <StatBlock label="Pass rate" value={passRatePct} />
      </div>

      <div className="af2-card" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--af2-ink-soft, #6b7280)" }}>
              <th style={{ padding: "10px 12px", width: 36 }}>#</th>
              <th style={{ padding: "10px 12px", width: 80 }}>Result</th>
              <th style={{ padding: "10px 12px", width: 100 }}>Status</th>
              <th style={{ padding: "10px 12px" }}>Expected</th>
              <th style={{ padding: "10px 12px" }}>Actual</th>
            </tr>
          </thead>
          <tbody>
            {detail.rows.map((row: EvalRow) => {
              const pill = passPill(row.pass);
              return (
                <tr key={row.runId} style={{ borderTop: "1px solid var(--af2-line, rgba(0,0,0,0.08))" }}>
                  <td style={{ padding: "10px 12px", color: "var(--af2-ink-soft, #6b7280)" }}>{row.index + 1}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: pill.bg,
                        color: pill.fg,
                      }}
                    >
                      {pill.label}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px", ...MONO, color: "var(--af2-ink-soft, #6b7280)" }}>{row.status}</td>
                  <td style={{ padding: "10px 12px", ...MONO }}>{compactJson(row.expected)}</td>
                  <td style={{ padding: "10px 12px", ...MONO }}>
                    {row.pass === false && row.mismatches.length > 0 ? (
                      <span>
                        {row.mismatches.map((m) => (
                          <div key={m.key} style={{ color: "#b91c1c" }}>
                            {m.key}: {compactJson(m.actual)} <span style={{ color: "var(--af2-ink-soft, #6b7280)" }}>(want {compactJson(m.expected)})</span>
                          </div>
                        ))}
                      </span>
                    ) : row.error ? (
                      <span style={{ color: "#b91c1c" }}>{row.error}</span>
                    ) : (
                      compactJson(row.actual)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
