/**
 * EpisodeScrubber — HEL-214 Pro reveal mounted on the Memory surface.
 *
 * Pro users can scrub a time slider and see which episodes (run / agent
 * activity bundles) existed at that moment. Powered by
 * `GET /api/memory/episodes?as_of=ISO_DATE`. The scaffold returns a small
 * synthetic list so the slider plumbing is reviewable.
 */
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { proGet } from "./proApi";

interface Episode {
  id: string;
  label: string;
  startedAt: string;
  endedAt: string | null;
  agentId?: string;
}

function isoFromOffset(daysAgo: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

const RANGE_DAYS = 30;

export function EpisodeScrubber() {
  const { getAccessToken } = useAuth();
  // `daysAgo` 0 = today, RANGE_DAYS = 30 days ago.
  const [daysAgo, setDaysAgo] = useState(0);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const asOf = useMemo(() => isoFromOffset(daysAgo), [daysAgo]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const token = await getAccessToken();
        const data = await proGet<{ episodes: Episode[] }>(
          `/memory/episodes?as_of=${encodeURIComponent(asOf)}`,
          token,
        );
        if (!cancelled) setEpisodes(data.episodes ?? []);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Lookup failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [asOf, getAccessToken]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
          As of: {new Date(asOf).toUTCString()}
        </span>
        <input
          type="range"
          min={0}
          max={RANGE_DAYS}
          value={daysAgo}
          onChange={(e) => setDaysAgo(Number(e.target.value))}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--af2-ink-3)",
          }}
        >
          <span>{RANGE_DAYS} days ago</span>
          <span>today</span>
        </div>
      </label>
      {error ? (
        <div style={{ color: "var(--af2-clay-2)", fontSize: 12 }}>{error}</div>
      ) : null}
      {loading ? (
        <div style={{ fontSize: 12, color: "var(--af2-ink-3)" }}>Loading...</div>
      ) : episodes.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--af2-ink-3)" }}>
          No episodes at that timestamp.
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
          {episodes.map((ep) => (
            <li
              key={ep.id}
              style={{
                padding: "8px 10px",
                border: "1px solid var(--af2-line)",
                borderRadius: 6,
                background: "var(--af2-paper)",
                fontSize: 13,
              }}
            >
              <div>
                <strong>{ep.label}</strong>
              </div>
              <div style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
                {ep.startedAt}
                {ep.endedAt ? ` -> ${ep.endedAt}` : " . live"}
                {ep.agentId ? ` . ${ep.agentId}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default EpisodeScrubber;
