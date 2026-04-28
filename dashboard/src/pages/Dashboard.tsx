import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Clock3,
  Filter,
  RefreshCcw,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  getObservabilityThroughput,
  listObservabilityEvents,
  streamObservabilityEvents,
  type ObservabilityEvent,
  type ObservabilityEventCategory,
  type ObservabilityThroughputSnapshot,
} from "../api/observability";
import { ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";

type FeedFilter = "all" | ObservabilityEventCategory;
type TransportState = "connecting" | "live" | "reconnecting" | "polling" | "error";

const WINDOW_OPTIONS = [1, 6, 24] as const;
const FILTER_OPTIONS: Array<{ value: FeedFilter; label: string }> = [
  { value: "all", label: "All activity" },
  { value: "issue", label: "Issues" },
  { value: "run", label: "Runs" },
  { value: "alert", label: "Alerts" },
];

const MAX_FEED_ITEMS = 20;
const POLLING_INTERVAL_MS = 15_000;
const MAX_RECONNECT_ATTEMPTS = 2;

export default function Dashboard() {
  const { requireAccessToken } = useAuth();
  const [feed, setFeed] = useState<ObservabilityEvent[]>([]);
  const [throughput, setThroughput] = useState<ObservabilityThroughputSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transportState, setTransportState] = useState<TransportState>("connecting");
  const [windowHours, setWindowHours] = useState<(typeof WINDOW_OPTIONS)[number]>(24);
  const [categoryFilter, setCategoryFilter] = useState<FeedFilter>("all");
  const [transportDetail, setTransportDetail] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const latestCursorRef = useRef<string | undefined>(undefined);
  const reconnectAttemptRef = useRef(0);
  const pollIntervalRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  const selectedCategories = useMemo(
    () => (categoryFilter === "all" ? undefined : [categoryFilter]),
    [categoryFilter]
  );

  const mergeFeed = useCallback((incoming: ObservabilityEvent[]) => {
    if (incoming.length === 0) return;

    setFeed((current) => {
      const merged = new Map(current.map((event) => [event.id, event]));
      for (const event of incoming) {
        merged.set(event.id, event);
      }

      const next = Array.from(merged.values())
        .sort((left, right) => Number(right.sequence) - Number(left.sequence))
        .slice(0, MAX_FEED_ITEMS);

      latestCursorRef.current = next.reduce<string | undefined>((cursor, event) => {
        if (!cursor || Number(event.sequence) > Number(cursor)) {
          return event.sequence;
        }
        return cursor;
      }, latestCursorRef.current);

      return next;
    });

    setLastUpdatedAt(incoming[0]?.occurredAt ?? new Date().toISOString());
  }, []);

  const stopRealtime = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;

    if (pollIntervalRef.current) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (accessToken: string, reason: string) => {
      stopRealtime();
      setTransportState("polling");
      setTransportDetail(reason);

      pollIntervalRef.current = window.setInterval(() => {
        void (async () => {
          try {
            const [page, snapshot] = await Promise.all([
              listObservabilityEvents(accessToken, {
                after: latestCursorRef.current,
                categories: selectedCategories,
                limit: MAX_FEED_ITEMS,
              }),
              getObservabilityThroughput(accessToken, windowHours),
            ]);

            mergeFeed(page.events);
            setThroughput(snapshot);
            setLastUpdatedAt(snapshot.generatedAt);
          } catch (pollError) {
            setTransportState("error");
            setTransportDetail(
              pollError instanceof Error ? pollError.message : "Polling fallback failed"
            );
          }
        })();
      }, POLLING_INTERVAL_MS);
    },
    [mergeFeed, selectedCategories, stopRealtime, windowHours]
  );

  const startStream = useCallback(
    (accessToken: string) => {
      stopRealtime();
      const controller = new AbortController();
      streamAbortRef.current = controller;
      setTransportState(latestCursorRef.current ? "reconnecting" : "connecting");

      void streamObservabilityEvents(accessToken, {
        after: latestCursorRef.current,
        categories: selectedCategories,
        limit: 100,
        signal: controller.signal,
        onEvent: (event) => {
          reconnectAttemptRef.current = 0;
          setTransportState("live");
          setTransportDetail("Fresh events are streaming from the control plane.");
          mergeFeed([event]);
        },
        onReady: (ready) => {
          reconnectAttemptRef.current = 0;
          if (ready.nextCursor) {
            latestCursorRef.current = ready.nextCursor;
          }
          setTransportState("live");
          setTransportDetail(
            ready.replayed > 0
              ? `Replayed ${ready.replayed} events before switching to live updates.`
              : "Streaming live updates."
          );
          setLastUpdatedAt(ready.generatedAt);
        },
        onKeepalive: (keepalive) => {
          setLastUpdatedAt(keepalive.generatedAt);
        },
      })
        .then(() => {
          if (!controller.signal.aborted) {
            startPolling(accessToken, "Live stream closed. Polling every 15 seconds.");
          }
        })
        .catch((streamError) => {
          if (controller.signal.aborted) return;

          const message =
            streamError instanceof Error ? streamError.message : "Live stream unavailable";
          if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttemptRef.current += 1;
            setTransportState("reconnecting");
            setTransportDetail(`Reconnecting to live stream (${reconnectAttemptRef.current}/${MAX_RECONNECT_ATTEMPTS})...`);
            reconnectTimeoutRef.current = window.setTimeout(() => {
              startStream(accessToken);
            }, 2_500);
            return;
          }

          startPolling(accessToken, `${message} Falling back to polling.`);
        });
    },
    [mergeFeed, selectedCategories, startPolling, stopRealtime]
  );

  const loadDashboard = useCallback(async () => {
    stopRealtime();
    reconnectAttemptRef.current = 0;
    setLoading(true);
    setError(null);
    setTransportDetail(null);

    try {
      const accessToken = await requireAccessToken();
      const [page, snapshot] = await Promise.all([
        listObservabilityEvents(accessToken, {
          categories: selectedCategories,
          limit: MAX_FEED_ITEMS,
        }),
        getObservabilityThroughput(accessToken, windowHours),
      ]);

      const sortedFeed = [...page.events].sort(
        (left, right) => Number(right.sequence) - Number(left.sequence)
      );
      setFeed(sortedFeed.slice(0, MAX_FEED_ITEMS));
      latestCursorRef.current = sortedFeed[0]?.sequence;
      setThroughput(snapshot);
      setLastUpdatedAt(snapshot.generatedAt);
      setLoading(false);

      startStream(accessToken);
    } catch (loadError) {
      setLoading(false);
      setTransportState("error");
      setError(loadError instanceof Error ? loadError.message : "Failed to load observability");
    }
  }, [requireAccessToken, selectedCategories, startStream, stopRealtime, windowHours]);

  useEffect(() => {
    void loadDashboard();
    return () => stopRealtime();
  }, [loadDashboard, stopRealtime]);

  const renderedBuckets = useMemo(() => {
    const buckets = throughput?.buckets.slice(-8) ?? [];
    const maxValue = Math.max(
      1,
      ...buckets.map((bucket) => bucket.createdCount + bucket.completedCount + bucket.blockedCount)
    );

    return buckets.map((bucket) => ({
      ...bucket,
      total: bucket.createdCount + bucket.completedCount + bucket.blockedCount,
      heightPercent:
        ((bucket.createdCount + bucket.completedCount + bucket.blockedCount) / maxValue) * 100,
    }));
  }, [throughput]);

  if (loading) {
    return (
      <div className="p-8">
        <LoadingState label="Loading observability cockpit..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorState
          title="Observability dashboard unavailable"
          message={error}
          onRetry={() => {
            void loadDashboard();
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8">
      <section className="overflow-hidden rounded-[28px] border border-surface-800/70 bg-slate-950 text-white shadow-2xl shadow-slate-950/35">
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.32),transparent_38%),radial-gradient(circle_at_top_right,rgba(20,184,166,0.18),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(249,115,22,0.16),transparent_28%)]" />
          <div className="relative grid gap-6 px-6 py-6 lg:grid-cols-[1.35fr,0.65fr] lg:px-8">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">
                <Activity className="h-3.5 w-3.5 text-brand-300" />
                Observability cockpit
              </div>
              <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-white md:text-4xl">
                Live activity, health, and throughput in one operator view.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 md:text-base">
                Sprint 1 is focused on fast operator judgment: one feed, one KPI, and clear
                transport continuity when live updates degrade.
              </p>

              <div className="mt-6 flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                    <Filter className="h-3.5 w-3.5" />
                    Feed filter
                  </span>
                  {FILTER_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={categoryFilter === option.value}
                      onClick={() => setCategoryFilter(option.value)}
                      className={`rounded-full border px-3 py-1.5 text-sm transition ${
                        categoryFilter === option.value
                          ? "border-brand-300 bg-brand-500/20 text-white"
                          : "border-white/10 bg-white/5 text-slate-300 hover:border-brand-400/50 hover:text-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                    <Clock3 className="h-3.5 w-3.5" />
                    Time range
                  </span>
                  {WINDOW_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={windowHours === option}
                      onClick={() => setWindowHours(option)}
                      className={`rounded-full border px-3 py-1.5 text-sm transition ${
                        windowHours === option
                          ? "border-teal-300 bg-teal-500/15 text-white"
                          : "border-white/10 bg-white/5 text-slate-300 hover:border-teal-400/50 hover:text-white"
                      }`}
                    >
                      {option}h
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/5 p-5 backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Transport status
                  </p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {transportStateLabel(transportState)}
                  </p>
                </div>
                <TransportPill state={transportState} />
              </div>

              <p className="mt-4 text-sm leading-6 text-slate-300">
                {transportDetail ?? "Waiting for the stream handshake to complete."}
              </p>

              <div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                <div className="flex items-center justify-between gap-3 text-sm text-slate-300">
                  <span>Last refresh</span>
                  <span className="font-medium text-white">
                    {lastUpdatedAt ? formatDateTime(lastUpdatedAt) : "Waiting for data"}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-sm text-slate-300">
                  <span>Fallback mode</span>
                  <span className="font-medium text-white">
                    {transportState === "polling" ? "Polling every 15s" : "Standby"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void loadDashboard();
                  }}
                  className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white transition hover:border-brand-400/50 hover:bg-brand-500/10"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Refresh data
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {transportState === "polling" && (
        <div className="rounded-2xl border border-amber-300/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Live streaming is unavailable. The dashboard is maintaining continuity with the polling
          fallback defined in Sprint 1.
        </div>
      )}

      {transportState === "error" && (
        <div className="rounded-2xl border border-red-300/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          Live transport is degraded. Use refresh to retry the stream handshake and keep the feed
          current.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.9fr,1.1fr]">
        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900/70">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                KPI prototype
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                Throughput over the last {windowHours} hours
              </h2>
            </div>
            <div className="rounded-2xl border border-brand-200 bg-brand-50 p-3 text-brand-600 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300">
              <BarChart3 className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-8 flex items-end gap-4">
            <div>
              <p className="text-5xl font-semibold tracking-tight text-slate-950 dark:text-white">
                {throughput?.summary.completedCount ?? 0}
              </p>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                completed tasks in the active window
              </p>
            </div>
            <div className="mb-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
              {Math.round((throughput?.summary.completionRate ?? 0) * 100)}% completion rate
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <MetricChip
              label="Created"
              value={throughput?.summary.createdCount ?? 0}
              tone="brand"
            />
            <MetricChip
              label="Completed"
              value={throughput?.summary.completedCount ?? 0}
              tone="teal"
            />
            <MetricChip
              label="Blocked"
              value={throughput?.summary.blockedCount ?? 0}
              tone="orange"
            />
          </div>

          <div className="mt-8 rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-surface-800 dark:bg-slate-950/40">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  Window cadence
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Created, completed, and blocked activity by bucket
                </p>
              </div>
              <span className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                {windowHours}h
              </span>
            </div>

            <div className="mt-5 grid grid-cols-8 items-end gap-2">
              {renderedBuckets.map((bucket) => (
                <div key={bucket.bucketStart} className="flex flex-col items-center gap-2">
                  <div className="flex h-28 w-full items-end justify-center rounded-2xl bg-white px-2 py-2 dark:bg-surface-900">
                    <div
                      className="w-full rounded-full bg-gradient-to-t from-brand-500 via-teal-400 to-orange-300"
                      style={{ height: `${Math.max(bucket.heightPercent, 12)}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {formatBucketLabel(bucket.bucketStart)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900/70">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                Live feed
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                Activity updates as they happen
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Showing the latest {Math.min(feed.length, MAX_FEED_ITEMS)} events with{" "}
                {categoryFilter === "all" ? "all categories" : `${categoryFilter} focus`} across a{" "}
                {windowHours}-hour operating window.
              </p>
            </div>

            <Link
              to="/history"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-brand-300 hover:text-brand-700 dark:border-surface-800 dark:text-slate-300 dark:hover:border-brand-500/50 dark:hover:text-brand-300"
            >
              Full history
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-6 space-y-3">
            {feed.length === 0 ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-6 text-center dark:border-surface-700 dark:bg-slate-950/40">
                <WifiOff className="h-10 w-10 text-slate-400" />
                <h3 className="mt-4 text-lg font-medium text-slate-900 dark:text-white">
                  No activity in this view
                </h3>
                <p className="mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                  Try a broader time range or switch the feed filter back to all activity to see
                  more of the control-plane timeline.
                </p>
              </div>
            ) : (
              feed.map((event) => (
                <article
                  key={event.id}
                  className="animate-slide-up rounded-[24px] border border-slate-200 bg-slate-50/70 px-4 py-4 transition hover:border-brand-300/40 hover:bg-brand-50/40 dark:border-surface-800 dark:bg-slate-950/45 dark:hover:border-brand-500/30 dark:hover:bg-brand-500/5"
                >
                  <div className="flex gap-4">
                    <div className="mt-1">{eventCategoryIcon(event.category)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={eventCategoryBadge(event.category)}>
                          {event.category}
                        </span>
                        <span className="text-xs text-slate-400">{formatDateTime(event.occurredAt)}</span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-slate-950 dark:text-white">
                        {event.summary}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
                        <span>{event.subject.label ?? event.subject.type}</span>
                        <span>{event.type}</span>
                        <span>{event.actor.label ?? event.actor.id}</span>
                      </div>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900/70">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Transport continuity
          </p>
          <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
            Sprint 1 live-state treatment is explicit, not inferred.
          </h3>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <StateGuide
              title="Live"
              description="Green emphasis with streaming updates."
              tone="emerald"
            />
            <StateGuide
              title="Reconnecting"
              description="Amber pulse while the stream re-establishes."
              tone="amber"
            />
            <StateGuide
              title="Polling"
              description="Dimmed continuity when live transport degrades."
              tone="slate"
            />
            <StateGuide
              title="Error"
              description="Red escalation when neither stream nor polling is healthy."
              tone="red"
            />
          </div>
        </section>

        <section className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50/80 p-6 shadow-sm dark:border-surface-700 dark:bg-slate-950/30">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Sprint 2 reserve
          </p>
          <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
            Space held for additional cards, charts, and alerting surfaces.
          </h3>
          <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
            The current composition leaves room for the broader observability stack without forcing
            a layout reset after the first KPI prototype proves the interaction model.
          </p>
        </section>
      </div>
    </div>
  );
}

function MetricChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "brand" | "teal" | "orange";
}) {
  const toneClasses =
    tone === "teal"
      ? "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-500/20 dark:bg-teal-500/10 dark:text-teal-300"
      : tone === "orange"
        ? "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/20 dark:bg-orange-500/10 dark:text-orange-300"
        : "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300";

  return (
    <div className={`rounded-[22px] border px-4 py-4 ${toneClasses}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.2em]">{label}</p>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function StateGuide({
  title,
  description,
  tone,
}: {
  title: string;
  description: string;
  tone: "emerald" | "amber" | "slate" | "red";
}) {
  const toneClasses =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10"
        : tone === "red"
          ? "border-red-200 bg-red-50 dark:border-red-500/20 dark:bg-red-500/10"
          : "border-slate-200 bg-slate-50 dark:border-surface-800 dark:bg-slate-950/45";

  return (
    <div className={`rounded-2xl border p-4 ${toneClasses}`}>
      <p className="text-sm font-semibold text-slate-950 dark:text-white">{title}</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
    </div>
  );
}

function TransportPill({ state }: { state: TransportState }) {
  const config =
    state === "live"
      ? {
          label: "Live",
          icon: <Wifi className="h-4 w-4" />,
          className:
            "border-emerald-300/30 bg-emerald-500/15 text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.08),0_0_18px_rgba(16,185,129,0.18)]",
        }
      : state === "reconnecting"
        ? {
            label: "Reconnecting",
            icon: <RefreshCcw className="h-4 w-4 animate-spin" />,
            className: "border-amber-300/30 bg-amber-500/15 text-amber-100",
          }
        : state === "polling"
          ? {
              label: "Polling",
              icon: <WifiOff className="h-4 w-4" />,
              className: "border-slate-300/20 bg-white/5 text-slate-200",
            }
          : state === "error"
            ? {
                label: "Error",
                icon: <AlertTriangle className="h-4 w-4" />,
                className: "border-red-300/30 bg-red-500/15 text-red-100",
              }
            : {
                label: "Connecting",
                icon: <Activity className="h-4 w-4 animate-glow-pulse" />,
                className: "border-brand-300/30 bg-brand-500/15 text-brand-100",
              };

  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${config.className}`}>
      {config.icon}
      <span>{config.label}</span>
    </div>
  );
}

function transportStateLabel(state: TransportState): string {
  if (state === "live") return "Streaming";
  if (state === "reconnecting") return "Recovering";
  if (state === "polling") return "Fallback active";
  if (state === "error") return "Attention needed";
  return "Connecting";
}

function eventCategoryBadge(category: ObservabilityEventCategory): string {
  if (category === "run") {
    return "rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-700 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300";
  }
  if (category === "heartbeat") {
    return "rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-700 dark:border-teal-500/20 dark:bg-teal-500/10 dark:text-teal-300";
  }
  if (category === "alert") {
    return "rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300";
  }
  if (category === "budget") {
    return "rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300";
  }
  return "rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-700 dark:border-orange-500/20 dark:bg-orange-500/10 dark:text-orange-300";
}

function eventCategoryIcon(category: ObservabilityEventCategory) {
  if (category === "run") {
    return (
      <div className="rounded-2xl border border-brand-200 bg-brand-50 p-3 text-brand-600 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300">
        <Activity className="h-4 w-4" />
      </div>
    );
  }
  if (category === "heartbeat") {
    return (
      <div className="rounded-2xl border border-teal-200 bg-teal-50 p-3 text-teal-600 dark:border-teal-500/20 dark:bg-teal-500/10 dark:text-teal-300">
        <Wifi className="h-4 w-4" />
      </div>
    );
  }
  if (category === "alert") {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
        <AlertTriangle className="h-4 w-4" />
      </div>
    );
  }
  if (category === "budget") {
    return (
      <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-3 text-cyan-600 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300">
        <BarChart3 className="h-4 w-4" />
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3 text-orange-600 dark:border-orange-500/20 dark:bg-orange-500/10 dark:text-orange-300">
      <Clock3 className="h-4 w-4" />
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBucketLabel(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
