/**
 * Mission Assignment SLA Dashboard — V2 editorial rebuild (DASH-18).
 *
 * Sub-route under Mission Assignments (/mission-assignments/sla).
 * Used to render in the V1 indigo/teal dark-mode chrome which
 * didn't match the editorial paper aesthetic on every other v2
 * surface. Rewritten to use the same af2-page / af2-stats /
 * af2-card / af2-list primitives.
 *
 * Data layer is unchanged from the v1 implementation:
 *   - `getTicketSlaDashboard()` returns summary cards + resolution
 *     bucket distribution + per-priority + per-actor breakdowns.
 *   - Reload on workspace change.
 *
 * Sub-page nav is preserved: links back to the queue and out to
 * SLA settings.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpRight,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { getTicketActorProfile } from "../api/tickets";
import {
  getTicketSlaDashboard,
  type TicketSlaDashboard,
} from "../api/ticketingSla";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";

export default function TicketSlaDashboard() {
  const { getAccessToken } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const [dashboard, setDashboard] = useState<TicketSlaDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const nextDashboard = await getTicketSlaDashboard(accessToken);
      setDashboard(nextDashboard);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load SLA dashboard",
      );
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadDashboard();
  }, [activeWorkspaceId, loadDashboard]);

  return (
    <div className="af2-page text-af2-ink">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Run · Assignments · SLA</div>
          <h1 className="af2-h1 font-af2-serif" style={{ marginTop: 6 }}>
            Mission Assignment SLA Dashboard
          </h1>
          <div className="af2-page-head-meta">
            Watch breach pressure, resolution distribution, and actor-level
            performance from one surface.
          </div>
        </div>
        <div className="af2-page-actions">
          <Link
            to="/mission-assignments"
            className="af2-btn af2-btn-ghost af2-btn-sm"
            style={{ textDecoration: "none" }}
          >
            ← Back to queue
          </Link>
          <Link
            to="/settings/ticketing-sla"
            className="af2-btn"
            style={{
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            SLA settings
            <ArrowUpRight size={13} />
          </Link>
          <button
            type="button"
            onClick={() => {
              void loadDashboard();
            }}
            className="af2-btn af2-btn-sm"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            aria-label="Refresh SLA dashboard"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="af2-card" style={{ padding: 40, textAlign: "center" }}>
          <Loader2
            className="animate-spin"
            style={{ margin: "0 auto 12px", opacity: 0.5 }}
          />
          <p className="af2-muted">Loading SLA dashboard…</p>
        </div>
      ) : error ? (
        <div
          role="alert"
          style={{
            padding: "12px 16px",
            borderRadius: "var(--af2-radius)",
            border: "1px solid rgba(192,84,76,0.30)",
            background: "rgba(192,84,76,0.10)",
            color: "var(--af2-clay)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : dashboard ? (
        <>
          {/* Summary strip — Breach Rate / Avg first response / Active breaches. */}
          <div className="af2-stats" style={{ marginBottom: 22 }}>
            {dashboard.summaryCards.map((card) => {
              const improving = card.trend === "improving";
              return (
                <div className="af2-stat" key={card.key}>
                  <div className="af2-stat-label">{card.label}</div>
                  <div className="af2-stat-value">{card.value}</div>
                  <div
                    className="af2-stat-delta"
                    style={{
                      color: improving ? "var(--af2-sage)" : "var(--af2-clay)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    {!improving ? <AlertTriangle size={11} /> : null}
                    {card.delta}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Two-column row: resolution distribution + per-priority breakdown */}
          <div
            style={{
              display: "grid",
              gap: 20,
              gridTemplateColumns: "minmax(0, 1.1fr) minmax(320px, 0.9fr)",
              marginBottom: 22,
            }}
          >
            <section className="af2-card" style={{ padding: 18 }}>
              <div className="af2-eyebrow">Time to resolution</div>
              <h2
                className="af2-h3 font-af2-serif"
                style={{ marginTop: 6, marginBottom: 14 }}
              >
                Distribution
              </h2>
              <div style={{ display: "grid", gap: 12 }}>
                {dashboard.resolutionBuckets.map((bucket) => (
                  <div
                    key={bucket.label}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "84px minmax(0, 1fr) 80px",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <span
                      className="af2-mono af2-muted-2"
                      style={{
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {bucket.label}
                    </span>
                    <div
                      style={{
                        height: 10,
                        borderRadius: 999,
                        background: "var(--af2-paper-2)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.max(bucket.percent, 4)}%`,
                          background: "var(--af2-clay)",
                          borderRadius: 999,
                          transition: "width 220ms ease-out",
                        }}
                      />
                    </div>
                    <span
                      className="af2-mono"
                      style={{
                        fontSize: 12,
                        textAlign: "right",
                        color: "var(--af2-ink-2)",
                      }}
                    >
                      {bucket.count} · {bucket.percent}%
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="af2-card" style={{ padding: 18 }}>
              <div className="af2-eyebrow">Per priority</div>
              <h2
                className="af2-h3 font-af2-serif"
                style={{ marginTop: 6, marginBottom: 14 }}
              >
                Breach rate
              </h2>
              <div style={{ display: "grid", gap: 8 }}>
                {dashboard.priorityBreakdown.map((row) => (
                  <Link
                    key={row.priority}
                    to={`/mission-assignments?priority=${row.priority}`}
                    className="af2-card"
                    style={{
                      padding: 12,
                      textDecoration: "none",
                      color: "inherit",
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) auto",
                      alignItems: "center",
                      gap: 10,
                      borderColor: "var(--af2-line)",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        className="af2-mono"
                        style={{
                          fontSize: 11,
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          color: "var(--af2-ink-3)",
                        }}
                      >
                        {row.priority}
                      </div>
                      <div
                        className="af2-muted"
                        style={{ fontSize: 12, marginTop: 4 }}
                      >
                        {row.activeCount} active · {row.atRiskCount} at risk
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div
                        className="font-af2-serif"
                        style={{
                          fontSize: 18,
                          fontWeight: 600,
                          color: "var(--af2-ink)",
                        }}
                      >
                        {row.breachRate}%
                      </div>
                      <div
                        className="af2-muted-2"
                        style={{ fontSize: 11 }}
                      >
                        breach rate
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          </div>

          {/* Per-actor table */}
          <section className="af2-card" style={{ padding: 18 }}>
            <div className="af2-eyebrow">Per actor</div>
            <h2
              className="af2-h3 font-af2-serif"
              style={{ marginTop: 6, marginBottom: 14 }}
            >
              Performance breakdown
            </h2>
            <div className="af2-list">
              <div
                className="af2-list-head"
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "minmax(0, 1.4fr) 90px 90px 100px 140px",
                  gap: 12,
                }}
              >
                <span>Actor</span>
                <span>Active</span>
                <span>At risk</span>
                <span>Breached</span>
                <span>Avg resolution</span>
              </div>
              {dashboard.actorBreakdown.map((row, idx) => {
                const profile = getTicketActorProfile(row.actor);
                return (
                  <Link
                    key={`${row.actor.type}:${row.actor.id}`}
                    to={`/mission-assignments/actors/${row.actor.type}/${row.actor.id}`}
                    className="af2-list-row"
                    style={{
                      gridTemplateColumns:
                        "minmax(0, 1.4fr) 90px 90px 100px 140px",
                      gap: 12,
                      textDecoration: "none",
                      color: "inherit",
                      cursor: "pointer",
                      borderBottom:
                        idx < dashboard.actorBreakdown.length - 1
                          ? "1px solid var(--af2-line)"
                          : "none",
                    }}
                  >
                    <span
                      className="font-af2-serif"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 14,
                        color: "var(--af2-ink)",
                      }}
                    >
                      {profile.name}
                      <ArrowUpRight
                        size={12}
                        style={{ color: "var(--af2-muted)" }}
                      />
                    </span>
                    <span
                      className="af2-mono"
                      style={{ fontSize: 12, color: "var(--af2-ink-2)" }}
                    >
                      {row.activeCount}
                    </span>
                    <span
                      className="af2-mono"
                      style={{ fontSize: 12, color: "var(--af2-mustard)" }}
                    >
                      {row.atRiskCount}
                    </span>
                    <span
                      className="af2-mono"
                      style={{ fontSize: 12, color: "var(--af2-clay)" }}
                    >
                      {row.breachedCount}
                    </span>
                    <span
                      className="af2-mono"
                      style={{ fontSize: 12, color: "var(--af2-ink-2)" }}
                    >
                      {row.avgResolutionHours.toFixed(1)}h
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
