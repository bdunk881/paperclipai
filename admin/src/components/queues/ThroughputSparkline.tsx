export interface ThroughputSparklineProps {
  completed: number[];
  failed: number[];
  windowMinutes: number;
}

const WIDTH = 480;
const HEIGHT = 64;

function buildPath(data: number[], maxValue: number, width: number, height: number): string {
  if (data.length === 0 || maxValue === 0) return "";
  // BullMQ returns data with the most-recent bucket first; reverse so the
  // line reads left-to-right oldest-to-newest.
  const series = data.slice().reverse();
  const step = width / Math.max(1, series.length - 1);
  return series
    .map((v, i) => {
      const x = i * step;
      const y = height - (v / maxValue) * (height - 4) - 2;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function sum(data: number[]): number {
  return data.reduce((a, b) => a + b, 0);
}

export function ThroughputSparkline({ completed, failed, windowMinutes }: ThroughputSparklineProps) {
  const max = Math.max(1, ...completed, ...failed);
  const completedSum = sum(completed);
  const failedSum = sum(failed);

  return (
    <div style={{ background: "#ffffff", border: "1px solid #e6e8eb", borderRadius: "8px", padding: "0.75rem 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
        <strong>Throughput · last {windowMinutes} min</strong>
        <span className="muted">
          <span style={{ color: "#1e4620", marginRight: "0.75rem" }}>● completed {completedSum}</span>
          <span style={{ color: "#6a1d1a" }}>● failed {failedSum}</span>
        </span>
      </div>
      {completed.length === 0 ? (
        <div className="muted" style={{ fontSize: "0.85rem" }}>
          No metrics collected yet. (Workers need `metrics: {`{ maxDataPoints: … }`}` enabled —
          deploy this PR's worker change to start collecting.)
        </div>
      ) : (
        <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: "100%", height: HEIGHT }}>
          <path d={buildPath(completed, max, WIDTH, HEIGHT)} stroke="#1e7a32" strokeWidth="1.5" fill="none" />
          <path d={buildPath(failed, max, WIDTH, HEIGHT)} stroke="#c53030" strokeWidth="1.5" fill="none" />
        </svg>
      )}
    </div>
  );
}
