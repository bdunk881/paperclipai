/**
 * Connector Health (HEL-179 Gap 2).
 *
 * Operator-facing view of every workspace connector's current state:
 * healthy / degraded / rate-limited / auth-failed / disabled.
 *
 * The backend route `GET /api/connectors/health` + the typed client
 * `getConnectorHealth()` (in `dashboard/src/api/client.ts`) have been
 * wired for months. This page is the user-visible surface — without it,
 * a revoked Slack token silently 404s an agent's tool call instead of
 * prompting the operator to reconnect.
 *
 * The page polls every 30s so a freshly-revoked token surfaces within
 * the next refresh cycle.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, ShieldAlert, Zap } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import {
  getConnectorHealth,
  type ConnectorHealthRecord,
  type ConnectorHealthState,
  type ConnectorHealthSummary,
} from "../api/client";
import { ErrorState, LoadingState } from "../components/UiStates";

const POLL_INTERVAL_MS = 30_000;

const STATE_META: Record<
  ConnectorHealthState,
  { label: string; pillClass: string; icon: typeof CheckCircle2; severity: number }
> = {
  // severity drives sort order — auth_failed first so the operator sees
  // what needs their attention before scrolling past every healthy row.
  auth_failed: { label: "Needs reconnect", pillClass: "af2-pill-clay", icon: ShieldAlert, severity: 0 },
  provider_error: { label: "Provider error", pillClass: "af2-pill-clay", icon: AlertCircle, severity: 1 },
  rate_limited: { label: "Rate limited", pillClass: "af2-pill-pending", icon: Zap, severity: 2 },
  degraded: { label: "Degraded", pillClass: "af2-pill-pending", icon: AlertCircle, severity: 3 },
  disabled: { label: "Disabled", pillClass: "af2-pill", icon: AlertCircle, severity: 4 },
  healthy: { label: "Healthy", pillClass: "af2-pill-live", icon: CheckCircle2, severity: 5 },
};

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export default function ConnectorHealth() {
  const { getAccessToken } = useAuth();
  const [data, setData] = useState<{
    connectors: ConnectorHealthRecord[];
    summary: ConnectorHealthSummary;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  // Tracks whether we currently have good data to fall back to. Read via
  // ref inside `load` so the callback identity doesn't change on every
  // successful fetch (which would re-arm the polling interval needlessly).
  const hasDataRef = useRef(false);

  const load = useCallback(
    async (background: boolean) => {
      if (background) {
        setRefreshing(true);
      } else {
        setInitialLoading(true);
        // Only foreground loads clear the existing error state. A background
        // poll firing during an outage must NOT blank the retry UI (Codex P1
        // on #923) — if `hasDataRef` is false after the initial-load failure,
        // clearing `error` here would hide the retry CTA on the next render
        // cycle while the backend is still down.
        setError(null);
      }
      try {
        const token = (await getAccessToken()) ?? undefined;
        const payload = await getConnectorHealth(token);
        setData(payload);
        hasDataRef.current = true;
        setError(null); // success → drop any prior error.
        setLastFetchedAt(Date.now());
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load connector health";
        // Foreground loads always surface the error. Background polls only
        // surface it when there's no good data to fall back to — otherwise
        // a single transient poll failure shouldn't blow away the
        // previously-good list.
        if (!background || !hasDataRef.current) {
          setError(message);
        }
      } finally {
        setInitialLoading(false);
        setRefreshing(false);
      }
    },
    [getAccessToken],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void load(true);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const sortedConnectors = useMemo<ConnectorHealthRecord[]>(() => {
    if (!data) return [];
    return [...data.connectors].sort((a, b) => {
      const aSev = STATE_META[a.state].severity;
      const bSev = STATE_META[b.state].severity;
      if (aSev !== bSev) return aSev - bSev;
      return a.connectorName.localeCompare(b.connectorName);
    });
  }, [data]);

  if (initialLoading && !data) {
    return (
      <div className="af2-page">
        <LoadingState label="Loading connector health…" />
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="af2-page">
        <ErrorState message={error} onRetry={() => void load(false)} />
      </div>
    );
  }
  if (!data) return null;

  const { summary } = data;
  const attentionCount =
    (summary.states.auth_failed ?? 0) +
    (summary.states.provider_error ?? 0) +
    (summary.states.degraded ?? 0) +
    (summary.states.rate_limited ?? 0);

  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Connect · Integrations</div>
          <h1 className="af2-h1 font-af2-serif" style={{ marginTop: 6 }}>
            Connector health
          </h1>
          <div className="af2-page-head-meta">
            {summary.total} {summary.total === 1 ? "connector" : "connectors"}
            {attentionCount > 0
              ? ` · ${attentionCount} need${attentionCount === 1 ? "s" : ""} attention`
              : " · all healthy"}
            {lastFetchedAt ? ` · refreshed ${formatRelative(new Date(lastFetchedAt).toISOString())}` : ""}
          </div>
        </div>
        <div className="af2-page-actions">
          <Link
            to="/integrations/mcp"
            className="af2-btn af2-btn-ghost af2-btn-sm"
            style={{ textDecoration: "none" }}
          >
            ← Integrations
          </Link>
          <button
            type="button"
            className="af2-btn af2-btn-sm"
            disabled={refreshing}
            onClick={() => void load(false)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            aria-label="Refresh connector health"
          >
            {refreshing ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            Refresh
          </button>
        </div>
      </div>

      {/* Summary strip — counts per state. Empty states render with 0. */}
      <div
        className="af2-card"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          padding: "14px 18px",
        }}
      >
        {(Object.keys(STATE_META) as ConnectorHealthState[]).map((state) => {
          const count = summary.states[state] ?? 0;
          const meta = STATE_META[state];
          const Icon = meta.icon;
          return (
            <div
              key={state}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                opacity: count === 0 ? 0.5 : 1,
              }}
            >
              <Icon size={14} aria-hidden="true" />
              <span style={{ fontSize: 13 }}>
                <strong style={{ marginRight: 4 }}>{count}</strong>
                {meta.label.toLowerCase()}
              </span>
            </div>
          );
        })}
      </div>

      {sortedConnectors.length === 0 ? (
        <div className="af2-card" style={{ padding: 24, textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "var(--af2-ink-2)" }}>
            No connectors registered yet.{" "}
            <Link to="/integrations/mcp" style={{ color: "var(--af2-clay)" }}>
              Add one →
            </Link>
          </p>
        </div>
      ) : (
        <div className="af2-list">
          {sortedConnectors.map((conn) => (
            <ConnectorRow key={conn.connectorKey} connector={conn} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectorRow({ connector }: { connector: ConnectorHealthRecord }) {
  const meta = STATE_META[connector.state];
  const Icon = meta.icon;
  const showReconnect =
    connector.state === "auth_failed" || connector.state === "provider_error";

  return (
    <div className="af2-list-item" style={{ padding: "12px 16px" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <strong style={{ fontSize: 14 }}>{connector.connectorName}</strong>
          <span className={`af2-pill ${meta.pillClass}`}>
            <Icon size={11} aria-hidden="true" />
            <span>{meta.label}</span>
          </span>
        </div>
        <div className="af2-muted" style={{ fontSize: 12.5 }}>
          {connector.lastErrorMessage && connector.state !== "healthy" ? (
            <span style={{ color: "var(--af2-clay)" }}>{connector.lastErrorMessage}</span>
          ) : (
            <span>
              Last successful call {formatRelative(connector.lastSuccessAt)}
              {connector.lastErrorAt
                ? ` · last error ${formatRelative(connector.lastErrorAt)}`
                : ""}
            </span>
          )}
        </div>
        {/* Numeric badges only when noteworthy */}
        {(connector.authFailures15m > 0 ||
          connector.rateLimitEvents15m > 0 ||
          connector.successRate24h < 99) && (
          <div
            className="af2-muted"
            style={{ fontSize: 12, marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}
          >
            <span>{connector.successRate24h.toFixed(1)}% 24h success</span>
            {connector.authFailures15m > 0 ? (
              <span style={{ color: "var(--af2-clay)" }}>
                {connector.authFailures15m} auth failure
                {connector.authFailures15m === 1 ? "" : "s"} / 15m
              </span>
            ) : null}
            {connector.rateLimitEvents15m > 0 ? (
              <span style={{ color: "var(--af2-mustard)" }}>
                {connector.rateLimitEvents15m} rate-limit hit
                {connector.rateLimitEvents15m === 1 ? "" : "s"} / 15m
              </span>
            ) : null}
          </div>
        )}
      </div>
      {showReconnect ? (
        <Link
          to={`/integrations/mcp?reconnect=${encodeURIComponent(connector.connectorKey)}`}
          className="af2-btn af2-btn-sm af2-btn-clay"
          style={{ textDecoration: "none", flexShrink: 0 }}
        >
          Reconnect
        </Link>
      ) : null}
    </div>
  );
}
