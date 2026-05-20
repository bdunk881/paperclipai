import type { CSSProperties, ReactNode } from "react";

export interface Af2PageProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  maxWidth?: number | string;
}

/** Thin wrapper around the v2 `.af2-page` chrome. */
export function Af2Page({ children, className, style, maxWidth }: Af2PageProps) {
  const mergedClass = ["af2-page", className].filter(Boolean).join(" ");
  const mergedStyle: CSSProperties = {
    ...(maxWidth !== undefined ? { maxWidth } : {}),
    ...style,
  };
  return (
    <div className={mergedClass} style={mergedStyle}>
      {children}
    </div>
  );
}
