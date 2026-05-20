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
          <h1 className="af2-h1 mt-1.5 font-af2-serif">
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
            className="af2-btn af2-btn-ghost af2-btn-sm no-underline"
          >
            ← Back to queue
          </Link>
          <Link
            to="/settings/ticketing-sla"
            className="af2-btn inline-flex items-center gap-1.5 no-underline"
          >
            SLA settings
            <ArrowUpRight size={13} />
          </Link>
          <button
            type="button"
            onClick={() => {
              void loadDashboard();
            }}
            className="af2-btn af2-btn-sm inline-flex items-center gap-1.5"
            aria-label="Refresh SLA dashboard"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="af2-card p-10 text-center">
          <Loader2 className="mx-auto mb-3 animate-spin opacity-50" />
          <p className="af2-muted">Loading SLA dashboard…</p>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-[var(--af2-radius)] border border-[rgba(192,84,76,0.30)] bg-[rgba(192,84,76,0.10)] px-4 py-3 text-[13px] text-af2-clay"
        >
          {error}
        </div>
      ) : dashboard ? (
        <>
          {/* Summary strip — Breach Rate / Avg first response / Active breaches. */}
          <div className="af2-stats mb-6">
            {dashboard.summaryCards.map((card) => {
              const improving = card.trend === "improving";
              return (
                <div className="af2-stat" key={card.key}>
                  <div className="af2-stat-label">{card.label}</div>
                  <div className="af2-stat-value">{card.value}</div>
                  <div
                    className="af2-stat-delta inline-flex items-center gap-1"
                    // Trend color is data-derived; static layout lives in classes.
                    style={{
                      color: improving ? "var(--af2-sage)" : "var(--af2-clay)",
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
          <div className="mb-6 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <section className="af2-card p-4">
              <div className="af2-eyebrow">Time to resolution</div>
              <h2 className="af2-h3 mb-3.5 mt-1.5 font-af2-serif">
                Distribution
              </h2>
              <div className="grid gap-3">
                {dashboard.resolutionBuckets.map((bucket) => (
                  <div
                    key={bucket.label}
                    className="grid items-center gap-3 [grid-template-columns:84px_minmax(0,1fr)_80px]"
                  >
                    <span
                      className="af2-mono af2-muted-2 text-[11px] uppercase tracking-[0.06em]"
                    >
                      {bucket.label}
                    </span>
                    <div className="h-2.5 overflow-hidden rounded-full bg-af2-paper-2">
                      <div
                        // Runtime width comes from live SLA bucket percentages;
                        // keep it inline so the bar accurately reflects data.
                        className="h-full rounded-full bg-af2-clay transition-[width] duration-200 ease-out"
                        style={{
                          width: `${Math.max(bucket.percent, 4)}%`,
                        }}
                      />
                    </div>
                    <span
                      className="af2-mono text-right text-xs text-af2-ink-2"
                    >
                      {bucket.count} · {bucket.percent}%
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="af2-card p-4">
              <div className="af2-eyebrow">Per priority</div>
              <h2 className="af2-h3 mb-3.5 mt-1.5 font-af2-serif">
                Breach rate
              </h2>
              <div className="grid gap-2">
                {dashboard.priorityBreakdown.map((row) => (
                  <Link
                    key={row.priority}
                    to={`/mission-assignments?priority=${row.priority}`}
                    className="af2-card grid items-center gap-2.5 border-af2-line p-3 text-inherit no-underline [grid-template-columns:minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0">
                      <div
                        className="af2-mono text-[11px] uppercase tracking-[0.08em] text-af2-ink-3"
                      >
                        {row.priority}
                      </div>
                      <div className="af2-muted mt-1 text-xs">
                        {row.activeCount} active · {row.atRiskCount} at risk
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-af2-serif text-lg font-semibold text-af2-ink">
                        {row.breachRate}%
                      </div>
                      <div className="af2-muted-2 text-[11px]">
                        breach rate
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          </div>

          {/* Per-actor table */}
          <section className="af2-card p-4">
            <div className="af2-eyebrow">Per actor</div>
            <h2 className="af2-h3 mb-3.5 mt-1.5 font-af2-serif">
              Performance breakdown
            </h2>
            <div className="af2-list">
              <div className="af2-list-head grid gap-3 [grid-template-columns:minmax(0,1.4fr)_90px_90px_100px_140px]">
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
                    className={`af2-list-row grid cursor-pointer gap-3 text-inherit no-underline [grid-template-columns:minmax(0,1.4fr)_90px_90px_100px_140px] ${
                      idx < dashboard.actorBreakdown.length - 1
                        ? "border-b border-af2-line"
                        : "border-b-0"
                    }`}
                  >
                    <span
                      className="inline-flex items-center gap-1.5 font-af2-serif text-sm text-af2-ink"
                    >
                      {profile.name}
                      <ArrowUpRight size={12} className="text-af2-ink-3" />
                    </span>
                    <span className="af2-mono text-xs text-af2-ink-2">
                      {row.activeCount}
                    </span>
                    <span className="af2-mono text-xs text-af2-mustard">
                      {row.atRiskCount}
                    </span>
                    <span className="af2-mono text-xs text-af2-clay">
                      {row.breachedCount}
                    </span>
                    <span className="af2-mono text-xs text-af2-ink-2">
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
