import type { CSSProperties, ReactNode } from "react";

export interface Af2EyebrowProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * v2 "eyebrow" — small uppercase tracking label above a page heading.
 * Renders `.af2-eyebrow` (defined in af2-components.css).
 *
 * Replaces the inline pattern that appears on every v2 page:
 *   <div className="af2-eyebrow">Run · Home</div>
 */
export function Af2Eyebrow({ children, className, style }: Af2EyebrowProps) {
  const merged = ["af2-eyebrow", className].filter(Boolean).join(" ");
  return (
    <div className={merged} style={style}>
      {children}
    </div>
  );
}
