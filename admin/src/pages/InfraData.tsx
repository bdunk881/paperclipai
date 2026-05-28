import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchInfraData,
  type PgHotTable,
  type PgInspectorView,
  type PgLongQuery,
  type RedisView,
  type SupabaseView,
} from "../api/dataApi";
import { flushRedisPattern, killPostgresQuery } from "../api/dataMutationsApi";
import { InfraTabs } from "../components/infra/InfraTabs";
import { MetricCard } from "../components/infra/MetricCard";
import { AskAgentButton } from "../components/agent/AskAgentButton";
import { ReasonPrompt } from "../components/ReasonPrompt";
import { DangerActionPrompt } from "../components/infra/DangerActionPrompt";

function formatBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function formatNumber(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d`;
}

function PostgresSection({ view, onMutated }: { view: PgInspectorView; onMutated: () => void }) {
  if (!view.available) {
    return <div className="banner">Postgres is not configured for this environment.</div>;
  }
  if (view.error) {
    return <div className="banner danger">{view.error}</div>;
  }
  const utilization =
    view.pool && view.pool.configured_max
      ? Math.round((view.pool.total / view.pool.configured_max) * 100)
      : null;
  return (
    <>
      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <MetricCard label="DB size" value={formatBytes(view.db_size_bytes)} />
        {view.pool && (
          <MetricCard
            label="Pool"
            value={`${view.pool.total}/${view.pool.configured_max ?? "?"}`}
            hint={`${view.pool.idle} idle · ${view.pool.waiting} waiting`}
            level={
              utilization === null
                ? "neutral"
                : utilization >= 90
                  ? "error"
                  : utilization >= 70
                    ? "warn"
                    : "ok"
            }
          />
        )}
        {view.activity && (
          <>
            <MetricCard
              label="Active queries"
              value={view.activity.active}
              hint="pg_stat_activity"
              level={view.activity.active > 20 ? "warn" : "neutral"}
            />
            <MetricCard
              label="Idle in transaction"
              value={view.activity.idle_in_transaction}
              level={view.activity.idle_in_transaction > 0 ? "warn" : "neutral"}
              hint="leaked txns?"
            />
            <MetricCard label="Total backends" value={view.activity.total} />
          </>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Long-running queries</h3>
          <AskAgentButton
            context={{
              kind: "postgres_query",
              source: "admin.infra.data",
              subjectRef: { kind: "long_queries", count: view.long_queries.length },
              payload: { long_queries: view.long_queries },
              defaultQuestion:
                view.long_queries.length > 0
                  ? "Are any of these long-running queries concerning?"
                  : "What should I monitor in Postgres next?",
            }}
            label="Ask agent"
          />
        </div>
        {view.long_queries.length === 0 ? (
          <p className="muted">No active queries older than the threshold.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>PID</th>
                <th>Age</th>
                <th>State</th>
                <th>Wait</th>
                <th>App</th>
                <th>User</th>
                <th>Query</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {view.long_queries.map((q: PgLongQuery) => (
                <tr key={q.pid}>
                  <td className="code">{q.pid}</td>
                  <td>{formatDuration(q.age_seconds)}</td>
                  <td>
                    <span className={`pill ${q.state === "idle in transaction" ? "warning" : ""}`}>
                      {q.state}
                    </span>
                  </td>
                  <td className="muted">
                    {q.wait_event_type ?? "—"}
                    {q.wait_event ? ` · ${q.wait_event}` : ""}
                  </td>
                  <td>{q.application_name ?? "—"}</td>
                  <td>{q.username ?? "—"}</td>
                  <td
                    className="code"
                    style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {q.query_excerpt}
                  </td>
                  <td>
                    <div className="row" style={{ gap: "0.3rem" }}>
                      <ReasonPrompt
                        label="Kill"
                        className="danger"
                        onConfirm={async (reason) => {
                          await killPostgresQuery({ pid: q.pid, reason });
                          onMutated();
                        }}
                      />
                      <AskAgentButton
                        context={{
                          kind: "postgres_query",
                          source: "admin.infra.data",
                          subjectRef: { pid: q.pid, age_seconds: q.age_seconds },
                          payload: { query: q },
                          defaultQuestion: `What is this Postgres query doing and is its age (${formatDuration(q.age_seconds)}) concerning?`,
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Top tables by size</h3>
        {view.hot_tables.length === 0 ? (
          <p className="muted">No tables.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Schema.Table</th>
                <th>Approx rows</th>
                <th>Heap size</th>
                <th>Total size (+ indexes)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {view.hot_tables.map((t: PgHotTable) => (
                <tr key={`${t.schema}.${t.name}`}>
                  <td className="code">
                    {t.schema}.{t.name}
                  </td>
                  <td>{formatNumber(t.approx_rows)}</td>
                  <td>{formatBytes(t.size_bytes)}</td>
                  <td>{formatBytes(t.total_size_bytes)}</td>
                  <td>
                    <AskAgentButton
                      context={{
                        kind: "postgres_table",
                        source: "admin.infra.data",
                        subjectRef: { schema: t.schema, table: t.name },
                        payload: { table: t },
                      }}
                    />
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

function FlushRedisCard({ onMutated }: { onMutated: () => void }) {
  const [pattern, setPattern] = useState("");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const canOpen = pattern.trim().length > 0;
  return (
    <div style={{ marginTop: "0.5rem" }}>
      <div className="row" style={{ gap: "0.5rem" }}>
        <input
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="rate-limit:* (deny-list: bull:*, session:*, cache:llm-config:*)"
          style={{ flex: 1 }}
        />
        <button className="danger" disabled={!canOpen} onClick={() => setOpen(true)}>
          Flush pattern…
        </button>
      </div>
      {result && (
        <div className="banner" style={{ marginTop: "0.5rem" }}>
          {result}
        </div>
      )}
      <DangerActionPrompt
        open={open}
        title={`Flush Redis keys matching ${pattern.trim() || "—"}`}
        description={
          <>
            SCAN + DEL all keys matching the pattern, in batches of 250. Capped at 10,000
            deletions per request. Deny-listed prefixes (<code className="code">bull:*</code>,{" "}
            <code className="code">session:*</code>, <code className="code">cache:llm-config:*</code>) are
            rejected server-side.
          </>
        }
        typedConfirm="FLUSH"
        confirmLabel="Flush keys"
        acknowledgementText="I've checked this pattern doesn't match operational state."
        onClose={() => setOpen(false)}
        onConfirm={async ({ reason }) => {
          const res = await flushRedisPattern({
            pattern: pattern.trim(),
            confirm: "FLUSH",
            reason,
          });
          setResult(`Flushed ${res.deleted} key(s)${res.scan_complete ? "" : " (more remain — re-run if needed)"}`);
          onMutated();
        }}
      />
    </div>
  );
}

function RedisSection({ view, onMutated }: { view: RedisView; onMutated: () => void }) {
  if (!view.available) {
    return <div className="banner">Redis is not configured for this environment.</div>;
  }
  if (!view.reachable) {
    return <div className="banner danger">Redis is unreachable: {view.error ?? "no INFO"}</div>;
  }
  const hitRate =
    view.hits !== null && view.misses !== null && view.hits + view.misses > 0
      ? (view.hits / (view.hits + view.misses)) * 100
      : null;
  return (
    <>
      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <MetricCard label="Version" value={view.version ?? "—"} />
        <MetricCard label="Uptime" value={formatDuration(view.uptime_seconds)} />
        <MetricCard label="Memory" value={formatBytes(view.used_memory_bytes)} hint={`peak ${formatBytes(view.used_memory_peak_bytes)}`} />
        <MetricCard
          label="Ops/sec"
          value={formatNumber(view.ops_per_sec)}
          hint={`${formatNumber(view.total_commands_processed)} total`}
        />
        <MetricCard label="Clients" value={formatNumber(view.connected_clients)} hint={`${view.blocked_clients ?? 0} blocked`} />
        <MetricCard
          label="Hit rate"
          value={hitRate === null ? "—" : `${hitRate.toFixed(1)}%`}
          level={hitRate === null ? "neutral" : hitRate >= 90 ? "ok" : hitRate >= 70 ? "warn" : "error"}
        />
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Keyspace</h3>
          <AskAgentButton
            context={{
              kind: "redis_info",
              source: "admin.infra.data",
              subjectRef: { kind: "keyspace" },
              payload: { keyspace: view.keyspace, persistence: view.persistence },
            }}
            label="Ask agent"
          />
        </div>
        {view.keyspace.length === 0 ? (
          <p className="muted">All databases empty.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>DB</th>
                <th>Keys</th>
                <th>With TTL</th>
                <th>Avg TTL</th>
              </tr>
            </thead>
            <tbody>
              {view.keyspace.map((k) => (
                <tr key={k.db}>
                  <td className="code">{k.db}</td>
                  <td>{formatNumber(k.keys)}</td>
                  <td>{formatNumber(k.expires)}</td>
                  <td>{k.avg_ttl_ms ? `${(k.avg_ttl_ms / 1000).toFixed(0)}s` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <FlushRedisCard onMutated={onMutated} />
      </div>
    </>
  );
}

function SupabaseSection({ view }: { view: SupabaseView }) {
  if (!view.configured) {
    return (
      <div className="banner">
        Supabase service-role client not configured. Set SUPABASE_URL +
        SUPABASE_SERVICE_ROLE_KEY to enable.
      </div>
    );
  }
  return (
    <>
      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <MetricCard label="Total users" value={formatNumber(view.total_users)} />
        <MetricCard
          label="Signups · 24h"
          value={formatNumber(view.user_count_24h)}
          hint="from latest 200 page"
        />
        <MetricCard
          label="MFA enrolled"
          value={formatNumber(view.mfa_enrolled_users)}
          hint="from auth.mfa_factors"
        />
      </div>

      {view.error && <div className="banner danger">{view.error}</div>}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Studio quick-links</h3>
          <AskAgentButton
            context={{
              kind: "supabase_state",
              source: "admin.infra.data",
              subjectRef: { kind: "rollup" },
              payload: { view },
              defaultQuestion: "Anything concerning in the Supabase rollup?",
            }}
            label="Ask agent"
          />
        </div>
        {Object.keys(view.studio_links).length === 0 ? (
          <p className="muted">
            Set <code className="code">SUPABASE_PROJECT_REF</code> to render quick-links.
          </p>
        ) : (
          <ul>
            {view.studio_links.table_editor && (
              <li>
                <a href={view.studio_links.table_editor} target="_blank" rel="noreferrer">
                  Table editor ↗
                </a>
              </li>
            )}
            {view.studio_links.auth_users && (
              <li>
                <a href={view.studio_links.auth_users} target="_blank" rel="noreferrer">
                  Auth users ↗
                </a>
              </li>
            )}
            {view.studio_links.logs && (
              <li>
                <a href={view.studio_links.logs} target="_blank" rel="noreferrer">
                  Logs explorer ↗
                </a>
              </li>
            )}
            {view.studio_links.edge_functions && (
              <li>
                <a href={view.studio_links.edge_functions} target="_blank" rel="noreferrer">
                  Edge functions ↗
                </a>
              </li>
            )}
          </ul>
        )}
        <p className="muted" style={{ fontSize: "0.78rem" }}>
          Sign-out-all-sessions + delete-factor verbs land in PR #7 (already
          available on Customer-360 today; PR #7 surfaces them on this tab
          too for support engineers to use without leaving the page).
        </p>
      </div>
    </>
  );
}

export function InfraDataPage() {
  const qc = useQueryClient();
  const { data, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["infra-data"],
    queryFn: fetchInfraData,
    refetchInterval: 30_000,
  });
  const onMutated = () => {
    void qc.invalidateQueries({ queryKey: ["infra-data"] });
  };

  return (
    <>
      <InfraTabs />
      <div className="row" style={{ justifyContent: "space-between", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.3rem", margin: 0 }}>Infrastructure · Data</h1>
        <button onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="banner danger">
          {error instanceof Error ? error.message : "Failed to load data view"}
        </div>
      )}

      <h2 style={{ fontSize: "1.05rem", marginTop: "1rem" }}>Postgres</h2>
      {isLoading || !data ? (
        <p className="muted">Loading…</p>
      ) : (
        <PostgresSection view={data.postgres} onMutated={onMutated} />
      )}

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Redis</h2>
      {isLoading || !data ? (
        <p className="muted">Loading…</p>
      ) : (
        <RedisSection view={data.redis} onMutated={onMutated} />
      )}

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Supabase</h2>
      {isLoading || !data ? <p className="muted">Loading…</p> : <SupabaseSection view={data.supabase} />}
    </>
  );
}
