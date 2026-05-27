import type { QueueCounters } from "../../api/queuesApi";

const TILES: Array<{ key: keyof QueueCounters; label: string; tone: "neutral" | "active" | "warn" | "danger" }> = [
  { key: "waiting", label: "Waiting", tone: "neutral" },
  { key: "active", label: "Active", tone: "active" },
  { key: "delayed", label: "Delayed", tone: "neutral" },
  { key: "failed", label: "Failed", tone: "danger" },
  { key: "completed", label: "Completed", tone: "neutral" },
];

const BORDER: Record<string, string> = {
  neutral: "#e6e8eb",
  active: "#bce4c4",
  warn: "#ffe69c",
  danger: "#f5b5b3",
};

export function QueueCounterTiles({ counters }: { counters: QueueCounters }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "0.5rem" }}>
      {TILES.map((t) => {
        const v = counters[t.key];
        const tone = t.key === "failed" && v > 0 ? "danger" : t.tone;
        return (
          <div
            key={t.key}
            style={{
              background: "#ffffff",
              border: `1px solid ${BORDER[tone]}`,
              borderRadius: "8px",
              padding: "0.75rem 1rem",
              textAlign: "left",
            }}
          >
            <div style={{ fontSize: "0.78rem", color: "#586271", textTransform: "uppercase" }}>
              {t.label}
            </div>
            <div style={{ fontSize: "1.6rem", fontWeight: 600 }}>{v}</div>
          </div>
        );
      })}
    </div>
  );
}
