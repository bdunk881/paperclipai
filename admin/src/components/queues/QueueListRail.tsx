import type { QueueListEntry } from "../../api/queuesApi";

export interface QueueListRailProps {
  queues: QueueListEntry[];
  selected: string;
  onSelect: (name: string) => void;
}

function totalStuck(entry: QueueListEntry): number {
  if (!entry.counters) return 0;
  return entry.counters.waiting + entry.counters.failed;
}

export function QueueListRail({ queues, selected, onSelect }: QueueListRailProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
        minWidth: 220,
      }}
    >
      {queues.map((q) => {
        const isSelected = q.name === selected;
        const stuck = totalStuck(q);
        const indicator =
          !q.available || q.error
            ? "•"
            : stuck > 50
              ? "✕"
              : stuck > 0
                ? "▲"
                : "●";
        const indicatorColor =
          !q.available || q.error
            ? "#6f7785"
            : stuck > 50
              ? "#6a1d1a"
              : stuck > 0
                ? "#5c4400"
                : "#1e4620";
        return (
          <button
            key={q.name}
            type="button"
            onClick={() => onSelect(q.name)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.5rem 0.75rem",
              border: isSelected ? "1px solid #1f57d3" : "1px solid #e6e8eb",
              borderRadius: "6px",
              background: isSelected ? "#eaf1ff" : "#ffffff",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ color: indicatorColor }} aria-hidden="true">
                {indicator}
              </span>
              <strong>{q.name}</strong>
            </span>
            <span style={{ fontSize: "0.85rem", color: "#586271" }}>
              {q.available && q.counters
                ? `${q.counters.waiting + q.counters.active}`
                : q.error
                  ? "err"
                  : "—"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
