/**
 * Tiny inline SVG sparkline. No deps; renders a smoothed line.
 */
import { type CSSProperties } from "react";

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  /** Optional title for accessibility. */
  label?: string;
  style?: CSSProperties;
}

export function Sparkline({
  values,
  width = 90,
  height = 24,
  stroke = "var(--af2-clay)",
  fill = "color-mix(in srgb, var(--af2-clay) 14%, transparent)",
  label,
  style,
}: SparklineProps) {
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / span) * height;
    return [x, y] as const;
  });

  const linePath = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");

  const areaPath =
    linePath +
    ` L ${width.toFixed(2)} ${height.toFixed(2)} L 0 ${height.toFixed(2)} Z`;

  return (
    <svg
      role={label ? "img" : "presentation"}
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{ display: "block", ...style }}
    >
      <path d={areaPath} fill={fill} stroke="none" />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth={1.5} />
    </svg>
  );
}
