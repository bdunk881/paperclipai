import type { ReactNode } from "react";

export type Af2PillTone =
  | "default"
  | "clay"
  | "sage"
  | "mustard"
  | "plum"
  | "live"
  | "pending";

const TONE_CLASS: Record<Af2PillTone, string> = {
  default: "",
  clay: "af2-pill-clay",
  sage: "af2-pill-live",
  live: "af2-pill-live",
  mustard: "af2-pill-pending",
  pending: "af2-pill-pending",
  plum: "af2-pill-plum",
};

export interface Af2PillProps {
  children: ReactNode;
  tone?: Af2PillTone;
  className?: string;
}

/**
 * v2 status pill — small toned chip used in tables, list rows, and
 * status strips. Maps to `.af2-pill` + tone modifier from styles.css.
 *
 * Use `tone="live"` for green/sage approved/running state,
 * `"pending"` for mustard awaiting-human, `"clay"` for clay-red blocked,
 * `"plum"` for governance/approval-flow.
 */
export function Af2Pill({ children, tone = "default", className }: Af2PillProps) {
  const merged = ["af2-pill", TONE_CLASS[tone], className].filter(Boolean).join(" ");
  return <span className={merged}>{children}</span>;
}
