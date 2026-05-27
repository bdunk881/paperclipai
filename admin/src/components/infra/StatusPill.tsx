export type StatusLevel = "ok" | "warn" | "error" | "unknown";

export interface StatusPillProps {
  label: string;
  level: StatusLevel;
  detail?: string;
}

const COLOR: Record<StatusLevel, { bg: string; fg: string; symbol: string }> = {
  ok: { bg: "#d4edda", fg: "#1e4620", symbol: "●" },
  warn: { bg: "#fff3cd", fg: "#5c4400", symbol: "▲" },
  error: { bg: "#fde2e1", fg: "#6a1d1a", symbol: "✕" },
  unknown: { bg: "#e6e8eb", fg: "#586271", symbol: "?" },
};

export function StatusPill({ label, level, detail }: StatusPillProps) {
  const c = COLOR[level];
  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: "0.15rem",
        padding: "0.5rem 0.75rem",
        borderRadius: "8px",
        background: c.bg,
        color: c.fg,
        minWidth: 140,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 600 }}>
        <span aria-hidden="true">{c.symbol}</span>
        <span>{label}</span>
      </div>
      {detail && (
        <div style={{ fontSize: "0.8rem", opacity: 0.85 }}>{detail}</div>
      )}
    </div>
  );
}
