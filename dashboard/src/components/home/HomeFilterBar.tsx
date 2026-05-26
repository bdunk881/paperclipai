/**
 * HomeFilterBar — mission selector + date range chooser for the home
 * dashboard. Sits between the page head and the stat tiles.
 *
 * Mission select uses a native <select> so we stay zero-dep; the
 * "All missions" option is the first row and the saved default for new
 * workspaces.
 *
 * Date range is a segment for the common presets plus a "Custom"
 * mode that reveals two datetime-local inputs.
 */
import { useState, type CSSProperties } from "react";
import type { Mission } from "../../api/missionsApi";
import {
  rangeFromPreset,
  type HomeDateRange,
  type HomeRangePreset,
} from "../../hooks/useHomeFilters";
import { truncateStatement } from "../../pages/orgStructureModel";

const RANGE_OPTIONS: Array<{ key: Exclude<HomeRangePreset, "custom">; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

interface HomeFilterBarProps {
  missions: Mission[];
  missionId: string | null;
  range: HomeDateRange;
  onMissionChange: (missionId: string | null) => void;
  onRangePreset: (preset: Exclude<HomeRangePreset, "custom">) => void;
  onCustomRange: (start: string, end: string) => void;
}

export function HomeFilterBar({
  missions,
  missionId,
  range,
  onMissionChange,
  onRangePreset,
  onCustomRange,
}: HomeFilterBarProps) {
  const [customOpen, setCustomOpen] = useState(range.preset === "custom");

  return (
    <div className="filterbar" style={{ marginTop: 10, marginBottom: 12 }}>
      <label
        style={{
          fontSize: 11,
          color: "var(--af2-ink-4)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 500,
        }}
      >
        Mission
      </label>
      <select
        aria-label="Filter by mission"
        value={missionId ?? "all"}
        onChange={(e) =>
          onMissionChange(e.target.value === "all" ? null : e.target.value)
        }
        style={{ minWidth: 200 }}
      >
        <option value="all">All missions</option>
        {missions.map((m) => (
          <option key={m.id} value={m.id}>
            {truncateStatement(m.statement, 40)} · {m.status}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="btn ghost sm"
        onClick={() => onMissionChange(null)}
        title="Show all missions"
        disabled={missionId === null}
        style={{ marginLeft: -4 }}
      >
        All
      </button>

      <div style={{ width: 12 }} />

      <label
        style={{
          fontSize: 11,
          color: "var(--af2-ink-4)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 500,
        }}
      >
        Range
      </label>
      <div className="seg" role="tablist" aria-label="Date range">
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={range.preset === opt.key}
            onClick={() => {
              setCustomOpen(false);
              onRangePreset(opt.key);
            }}
          >
            {opt.label}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={range.preset === "custom"}
          onClick={() => setCustomOpen((open) => !open)}
        >
          Custom
        </button>
      </div>

      {customOpen ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginLeft: 8,
            fontSize: 12,
          }}
        >
          <input
            type="datetime-local"
            value={toLocalInputValue(range.start)}
            onChange={(e) =>
              onCustomRange(fromLocalInputValue(e.target.value), range.end)
            }
            aria-label="Range start"
            style={inputStyle}
          />
          <span style={{ color: "var(--af2-ink-4)" }}>→</span>
          <input
            type="datetime-local"
            value={toLocalInputValue(range.end)}
            onChange={(e) =>
              onCustomRange(range.start, fromLocalInputValue(e.target.value))
            }
            aria-label="Range end"
            style={inputStyle}
          />
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              setCustomOpen(false);
              onRangePreset("today");
            }}
          >
            Clear
          </button>
        </div>
      ) : null}

      <div className="grow" />
      <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
        {formatRangeLabel(range)}
      </span>
    </div>
  );
}

const inputStyle: CSSProperties = {
  fontFamily: "var(--af2-mono, ui-monospace, SFMono-Regular, monospace)",
  fontSize: 12,
  background: "var(--af2-card)",
  border: "1px solid var(--af2-line)",
  borderRadius: 6,
  padding: "4px 6px",
  color: "var(--af2-ink)",
};

// Browser datetime-local inputs use the local-time ISO subset without
// the trailing `Z`. We convert in both directions so the underlying
// state stays in canonical UTC ISO.
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(value: string): string {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function formatRangeLabel(range: HomeDateRange): string {
  if (range.preset !== "custom") {
    const days = Math.max(
      1,
      Math.round(
        (new Date(range.end).getTime() - new Date(range.start).getTime()) /
          86_400_000,
      ),
    );
    if (range.preset === "today") return "since 12:00 AM";
    return `last ${days} days`;
  }
  const start = new Date(range.start).toLocaleString();
  const end = new Date(range.end).toLocaleString();
  return `${start} → ${end}`;
}

// Re-export the helper for callers that want to derive a range outside
// the hook (e.g. when rendering a fresh "today" reset).
export { rangeFromPreset };
