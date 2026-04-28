import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, AlertTriangle, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { getTicketActorProfile } from "../api/tickets";
import { getTicketSlaDashboard, type TicketSlaDashboard } from "../api/ticketingSla";
import { useAuth } from "../context/AuthContext";

export default function TicketSlaDashboard() {
  const { getAccessToken } = useAuth();
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
      setError(loadError instanceof Error ? loadError.message : "Failed to load SLA dashboard");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  return (
    <div className="min-h-full bg-[#0b1120] text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
        <section className="glass-card noise-overlay overflow-hidden rounded-[30px] border border-slate-800/80 bg-slate-950/85">
          <div className="relative border-b border-slate-800/80 px-6 py-6 md:px-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.18),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(20,184,166,0.14),transparent_30%)]" />
            <div className="relative flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <Link
                  to="/tickets"
                  className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-slate-100"
                >
                  <ArrowLeft size={14} />
                  Back to queue
                </Link>
                <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#FFD93D]/30 bg-[#FFD93D]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#fde68a]">
                  <AlertTriangle size={12} />
                  SLA Monitor
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-100">
                  Ticketing SLA Dashboard
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Watch breach pressure, resolution distribution, and actor-level performance from one operational surface.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Link
                  to="/settings/ticketing-sla"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-indigo-500/40 hover:text-indigo-100"
                >
                  SLA settings
                  <ArrowUpRight size={14} />
                </Link>
                <button
                  onClick={() => {
                    void loadDashboard();
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-teal-500/40 hover:text-teal-100"
                >
                  <RefreshCw size={14} />
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </section>

        {loading ? (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="scanline-skeleton min-h-[140px] rounded-[28px]" />
              ))}
            </div>
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
              <div className="scanline-skeleton min-h-[320px] rounded-[30px]" />
              <div className="scanline-skeleton min-h-[320px] rounded-[30px]" />
            </div>
          </>
        ) : error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : dashboard ? (
          <>
            <section className="grid gap-4 md:grid-cols-3">
              {dashboard.summaryCards.map((card) => (
                <article
                  key={card.key}
                  className="rounded-[28px] border border-slate-800 bg-slate-950/85 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.35)]"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {card.label}
                  </p>
                  <div className="mt-5 flex items-end justify-between gap-4">
                    <p className="font-ticket-mono text-4xl font-bold tracking-tight text-slate-100">
                      {card.value}
                    </p>
                    <p
                      className={clsx(
                        "rounded-full px-2.5 py-1 text-xs font-semibold",
                        card.trend === "improving"
                          ? "bg-teal-500/15 text-teal-200"
                          : "bg-[#FF5F57]/15 text-[#ffb2ae]"
                      )}
                    >
                      {card.delta}
                    </p>
                  </div>
                </article>
              ))}
            </section>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
              <section className="rounded-[30px] border border-slate-800 bg-slate-950/85 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Time to Resolution
                </p>
                <h2 className="mt-2 text-lg font-semibold text-slate-100">Distribution view</h2>
                <div className="mt-6 space-y-4">
                  {dashboard.resolutionBuckets.map((bucket) => (
                    <div key={bucket.label} className="grid gap-2 sm:grid-cols-[84px_minmax(0,1fr)_72px] sm:items-center">
                      <span className="font-ticket-mono text-xs uppercase tracking-[0.18em] text-slate-400">
                        {bucket.label}
                      </span>
                      <div className="h-11 overflow-hidden rounded-2xl bg-slate-800/90">
                        <div
                          className="h-full rounded-2xl bg-indigo-500 transition-[width] duration-300 ease-out"
                          style={{ width: `${Math.max(bucket.percent, 6)}%` }}
                        />
                      </div>
                      <span className="text-right text-sm text-slate-300">
                        {bucket.count} / {bucket.percent}%
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[30px] border border-slate-800 bg-slate-950/85 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Per Priority
                </p>
                <h2 className="mt-2 text-lg font-semibold text-slate-100">Breakdown table</h2>
                <div className="mt-5 space-y-3">
                  {dashboard.priorityBreakdown.map((row) => (
                    <Link
                      key={row.priority}
                      to={`/tickets?priority=${row.priority}`}
                      className="block rounded-[24px] border border-slate-800 bg-slate-900/70 px-4 py-4 transition hover:border-indigo-500/30 hover:bg-slate-900"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-ticket-mono text-xs uppercase tracking-[0.18em] text-slate-400">
                            {row.priority}
                          </p>
                          <p className="mt-2 text-sm text-slate-300">
                            {row.activeCount} active, {row.atRiskCount} at risk
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold text-slate-100">{row.breachRate}%</p>
                          <p className="text-xs text-slate-500">breach rate</p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            </div>

            <section className="rounded-[30px] border border-slate-800 bg-slate-950/85 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Per Actor
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-100">Performance breakdown</h2>
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-y-3">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      <th className="px-4">Actor</th>
                      <th className="px-4">Active</th>
                      <th className="px-4">At Risk</th>
                      <th className="px-4">Breached</th>
                      <th className="px-4">Avg Resolution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.actorBreakdown.map((row) => {
                      const profile = getTicketActorProfile(row.actor);
                      return (
                        <tr key={`${row.actor.type}:${row.actor.id}`} className="rounded-[24px] bg-slate-900/70">
                          <td className="rounded-l-[24px] px-4 py-4">
                            <Link
                              to={`/tickets/actors/${row.actor.type}/${row.actor.id}`}
                              className="inline-flex items-center gap-2 text-sm font-medium text-slate-100 transition hover:text-teal-200"
                            >
                              {profile.name}
                              <ArrowUpRight size={14} />
                            </Link>
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-300">{row.activeCount}</td>
                          <td className="px-4 py-4 text-sm text-[#fde68a]">{row.atRiskCount}</td>
                          <td className="px-4 py-4 text-sm text-[#ffb2ae]">{row.breachedCount}</td>
                          <td className="rounded-r-[24px] px-4 py-4 text-sm text-slate-300">
                            {row.avgResolutionHours.toFixed(1)}h
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
