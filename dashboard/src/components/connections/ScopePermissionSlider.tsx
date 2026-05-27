/**
 * ScopePermissionSlider — segmented three-state control (HEL-205 PR B).
 *
 * Drives the per-scope grant rows inside the Connections hub Manage panel:
 *   allow → sage   (default-on)
 *   ask   → mustard (HITL-on-use)
 *   deny  → clay   (explicitly blocked)
 *
 * Styled against the existing af2-* color tokens (see af2-components.css).
 * The active segment lifts its background to the matching token; inactive
 * segments stay paper-tone so the active state reads at a glance.
 */
import clsx from "clsx";

export type ScopePermission = "allow" | "ask" | "deny";

interface SegmentMeta {
  value: ScopePermission;
  label: string;
  /** af2 color token suffix (sage|mustard|clay). */
  accent: "sage" | "mustard" | "clay";
}

const SEGMENTS: readonly SegmentMeta[] = [
  { value: "allow", label: "Allow", accent: "sage" },
  { value: "ask", label: "Ask", accent: "mustard" },
  { value: "deny", label: "Deny", accent: "clay" },
];

export interface ScopePermissionSliderProps {
  value: ScopePermission;
  onChange: (next: ScopePermission) => void;
  label?: string;
  disabled?: boolean;
}

export function ScopePermissionSlider({
  value,
  onChange,
  label,
  disabled = false,
}: ScopePermissionSliderProps) {
  return (
    <div
      className="af2-scope-permission-slider"
      role="radiogroup"
      aria-label={label ?? "Scope permission"}
      style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
    >
      {label && (
        <span
          className="af2-eyebrow"
          style={{ fontSize: 11, color: "var(--af2-ink-3)" }}
        >
          {label}
        </span>
      )}
      <div
        style={{
          display: "inline-flex",
          padding: 2,
          background: "var(--af2-paper-2)",
          border: "1px solid var(--af2-line-2)",
          borderRadius: 999,
          gap: 2,
        }}
      >
        {SEGMENTS.map((seg) => {
          const active = seg.value === value;
          return (
            <button
              key={seg.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => {
                if (!disabled && !active) onChange(seg.value);
              }}
              className={clsx("af2-mono", `af2-scope-seg-${seg.accent}`)}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: 0.2,
                padding: "4px 12px",
                borderRadius: 999,
                border: "none",
                cursor: disabled ? "not-allowed" : "pointer",
                color: active ? "#fff" : "var(--af2-ink-2)",
                background: active ? `var(--af2-${seg.accent})` : "transparent",
                transition: "background 120ms ease, color 120ms ease",
                opacity: disabled ? 0.6 : 1,
              }}
            >
              {seg.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ScopePermissionSlider;
