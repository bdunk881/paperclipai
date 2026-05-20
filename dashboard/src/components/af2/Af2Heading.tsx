import type { CSSProperties, ReactNode } from "react";

interface BaseProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** v2 serif h1 — Fraunces, editorial. */
export function Af2H1({ children, className, style }: BaseProps) {
  const merged = ["af2-h1 font-af2-serif", className].filter(Boolean).join(" ");
  return (
    <h1 className={merged} style={{ marginTop: 6, ...style }}>
      {children}
    </h1>
  );
}

/** v2 serif h2 — section heading inside a page. */
export function Af2H2({ children, className, style }: BaseProps) {
  const merged = ["af2-h2 font-af2-serif", className].filter(Boolean).join(" ");
  return (
    <h2 className={merged} style={style}>
      {children}
    </h2>
  );
}

/** v2 serif h3 — sub-section heading. */
export function Af2H3({ children, className, style }: BaseProps) {
  const merged = ["af2-h3", className].filter(Boolean).join(" ");
  return (
    <h3 className={merged} style={style}>
      {children}
    </h3>
  );
}
