import { useEffect, useState } from "react";
import type { MetaFunction } from "react-router";
import { buildLandingApiUrl } from "../../lib/publicApi";

type Level = "operational" | "degraded" | "down" | "unknown";

interface Component {
  id: string;
  name: string;
  level: Level;
  message?: string;
}

interface StatusResponse {
  generated_at: string;
  overall: Level;
  components: Component[];
}

interface StatusEvent {
  id: string;
  component_id: string;
  component_name: string;
  level: Level;
  message: string | null;
  recorded_at: string;
}

export const meta: MetaFunction = () => [
  { title: "AutoFlow · Status" },
  { name: "robots", content: "index, follow" },
  {
    name: "description",
    content: "Current operating status of the AutoFlow platform.",
  },
];

const LEVEL_LABEL: Record<Level, string> = {
  operational: "All systems operational",
  degraded: "Some systems degraded",
  down: "Outage in progress",
  unknown: "Status unavailable",
};

const LEVEL_COLOR: Record<Level, { bg: string; fg: string; dot: string }> = {
  operational: { bg: "#e6f6ec", fg: "#1e4620", dot: "#1e7a32" },
  degraded: { bg: "#fff3cd", fg: "#5c4400", dot: "#b88406" },
  down: { bg: "#fde2e1", fg: "#6a1d1a", dot: "#c53030" },
  unknown: { bg: "#e6e8eb", fg: "#586271", dot: "#6f7785" },
};

function StatusDot({ level }: { level: Level }) {
  const c = LEVEL_COLOR[level];
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: 999,
        background: c.dot,
        marginRight: 8,
      }}
    />
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export default function StatusPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [events, setEvents] = useState<StatusEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [statusRes, eventsRes] = await Promise.all([
          fetch(buildLandingApiUrl("/api/public/status"), {
            method: "GET",
            credentials: "omit",
          }),
          fetch(buildLandingApiUrl("/api/public/status/events?limit=25"), {
            method: "GET",
            credentials: "omit",
          }),
        ]);
        if (!statusRes.ok) throw new Error(`HTTP ${statusRes.status}`);
        const payload = (await statusRes.json()) as StatusResponse;
        const eventsPayload = eventsRes.ok
          ? ((await eventsRes.json()) as { events: StatusEvent[] })
          : { events: [] };
        if (!cancelled) {
          setData(payload);
          setEvents(eventsPayload.events ?? []);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load status");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const interval = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const overallLevel: Level = data?.overall ?? (error ? "unknown" : "unknown");
  const overallColor = LEVEL_COLOR[overallLevel];

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "3rem auto",
        padding: "0 1.25rem",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        color: "#1c1c1e",
      }}
    >
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", margin: 0 }}>AutoFlow status</h1>
        <p style={{ color: "#586271", margin: "0.25rem 0 0 0" }}>
          Live operating status of the AutoFlow platform. Refreshes every 30 seconds.
        </p>
      </header>

      <section
        style={{
          background: overallColor.bg,
          color: overallColor.fg,
          padding: "1rem 1.25rem",
          borderRadius: 10,
          marginBottom: "1.5rem",
        }}
      >
        <strong style={{ fontSize: "1.1rem" }}>{LEVEL_LABEL[overallLevel]}</strong>
        {data && (
          <div style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>
            Updated {formatRelative(data.generated_at)}
          </div>
        )}
      </section>

      {error && (
        <div
          style={{
            background: LEVEL_COLOR.unknown.bg,
            color: LEVEL_COLOR.unknown.fg,
            padding: "0.75rem 1rem",
            borderRadius: 8,
            marginBottom: "1rem",
            fontSize: "0.9rem",
          }}
        >
          Status feed unreachable ({error}). The platform may still be operational —
          this banner only means status.helloautoflow.com couldn&apos;t reach the
          status feed.
        </div>
      )}

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.05rem", marginTop: 0, marginBottom: "0.75rem" }}>
          Components
        </h2>
        {loading && !data ? (
          <p style={{ color: "#586271" }}>Loading…</p>
        ) : data && data.components.length === 0 ? (
          <p style={{ color: "#586271" }}>No components configured.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {(data?.components ?? []).map((c) => {
              const color = LEVEL_COLOR[c.level];
              return (
                <li
                  key={c.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "0.75rem 1rem",
                    border: "1px solid #e6e8eb",
                    borderRadius: 8,
                    marginBottom: "0.5rem",
                    background: "#ffffff",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center" }}>
                    <StatusDot level={c.level} />
                    <strong>{c.name}</strong>
                    {c.message && (
                      <span style={{ color: "#586271", marginLeft: "0.5rem" }}>
                        — {c.message}
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      padding: "2px 10px",
                      borderRadius: 999,
                      background: color.bg,
                      color: color.fg,
                      fontSize: "0.78rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {c.level}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: "1.05rem", marginTop: 0, marginBottom: "0.75rem" }}>
          Incident timeline
        </h2>
        {events.length === 0 ? (
          <p style={{ color: "#586271" }}>
            No recent transitions. Components have been at their current levels since the
            timeline began.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {events.map((ev) => {
              const color = LEVEL_COLOR[ev.level];
              return (
                <li
                  key={ev.id}
                  style={{
                    display: "flex",
                    gap: "0.75rem",
                    padding: "0.5rem 0",
                    borderBottom: "1px solid #f0f1f3",
                    fontSize: "0.9rem",
                  }}
                >
                  <span
                    style={{
                      color: "#586271",
                      minWidth: 88,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatRelative(ev.recorded_at)}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", flex: 1 }}>
                    <StatusDot level={ev.level} />
                    <strong style={{ marginRight: 8 }}>{ev.component_name}</strong>
                    <span style={{ color: "#586271" }}>
                      → {ev.level}
                      {ev.message ? ` · ${ev.message}` : ""}
                    </span>
                  </span>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: color.bg,
                      color: color.fg,
                      fontSize: "0.7rem",
                      textTransform: "uppercase",
                    }}
                  >
                    {ev.level}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
