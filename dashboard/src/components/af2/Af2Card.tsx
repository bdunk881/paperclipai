import type { CSSProperties, ReactNode } from "react";

export interface Af2CardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  padding?: number | string;
}

/**
 * v2 card — paper-on-paper container with line border + soft shadow.
 * Maps to `.af2-card` in af2-components.css.
 *
 * Default padding is 18px to match the inline pattern used across pages
 * (Dashboard, MissionState, BudgetDashboard all use `padding: 18`).
 */
export function Af2Card({ children, className, style, padding = 18 }: Af2CardProps) {
  const merged = ["af2-card", className].filter(Boolean).join(" ");
  const mergedStyle: CSSProperties = { padding, ...style };
  return (
    <div className={merged} style={mergedStyle}>
      {children}
    </div>
  );
}
