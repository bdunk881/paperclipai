import { type ReactNode } from "react";

export interface MetricCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  level?: "ok" | "warn" | "error" | "neutral";
}

const BORDER: Record<NonNullable<MetricCardProps["level"]>, string> = {
  ok: "#bce4c4",
  warn: "#ffe69c",
  error: "#f5b5b3",
  neutral: "#e6e8eb",
};

export function MetricCard({ label, value, hint, level = "neutral" }: MetricCardProps) {
  return (
    <div
      style={{
        background: "#ffffff",
        border: `1px solid ${BORDER[level]}`,
        borderRadius: "8px",
        padding: "0.75rem 1rem",
        minWidth: 140,
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
      }}
    >
      <div style={{ fontSize: "0.78rem", color: "#586271", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.4rem", fontWeight: 600 }}>{value}</div>
      {hint && <div style={{ fontSize: "0.78rem", color: "#586271" }}>{hint}</div>}
    </div>
  );
}
