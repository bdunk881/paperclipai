/**
 * PaidFeatureGate — wraps a Pro-only feature (Flow tier and up).
 *
 * If the workspace's entitlement plan is in the paid set (flow / automate /
 * scale) we render `children` directly. Otherwise we render an in-line
 * upsell stub with a lock icon, a brief explanation, and a link to /billing
 * so the operator can upgrade.
 *
 * Use this around the *feature surface* (a button, a panel, a tab body),
 * not around an entire page — pages typically have their own gating chrome.
 */
import { Lock } from "lucide-react";
import { Link } from "react-router-dom";
import type { CSSProperties, ReactNode } from "react";
import { useIsPaidTier } from "../hooks/useIsPaidTier";

interface PaidFeatureGateProps {
  /** Short title rendered on the stub when locked. e.g. "Desktop notifications". */
  label: string;
  /** One-line explanation rendered under the title. */
  description?: string;
  /** Render mode: `inline` for small affordances, `card` for larger panels. */
  variant?: "inline" | "card";
  children: ReactNode;
}

export function PaidFeatureGate({
  label,
  description,
  variant = "card",
  children,
}: PaidFeatureGateProps) {
  const { isPaid, loading } = useIsPaidTier();
  // While the entitlement is in flight we render the locked stub rather
  // than the feature — better to under-promise for a few hundred ms than
  // flash a Pro UI then yank it.
  if (isPaid) return <>{children}</>;
  if (variant === "inline") {
    return (
      <span style={inlineStyle}>
        <Lock size={11} aria-hidden />
        <span>
          {label} on{" "}
          <Link to="/billing" className="link-clay">
            Flow plan
          </Link>
        </span>
      </span>
    );
  }
  return (
    <div style={cardStyle} role="group" aria-label={`${label} — Flow plan required`}>
      <div style={iconStyle}>
        <Lock size={16} aria-hidden />
      </div>
      <div style={bodyStyle}>
        <div style={titleStyle}>{label}</div>
        {description ? (
          <div style={descStyle}>{description}</div>
        ) : null}
        <div style={ctaStyle}>
          {loading ? (
            <span style={{ color: "var(--af2-ink-4)" }}>Checking plan…</span>
          ) : (
            <Link to="/billing" className="btn primary sm" style={{ textDecoration: "none" }}>
              Upgrade to Flow →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

const inlineStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  color: "var(--af2-ink-3)",
  padding: "2px 6px",
  borderRadius: 4,
  background: "var(--af2-paper-2)",
};

const cardStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  padding: "14px 16px",
  border: "1px dashed var(--af2-line-2)",
  borderRadius: 10,
  background: "var(--af2-paper-2)",
};

const iconStyle: CSSProperties = {
  flexShrink: 0,
  width: 32,
  height: 32,
  borderRadius: 8,
  background: "var(--af2-card)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--af2-ink-3)",
};

const bodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  flex: 1,
};

const titleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--af2-ink)",
};

const descStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--af2-ink-3)",
  lineHeight: 1.4,
};

const ctaStyle: CSSProperties = {
  marginTop: 4,
};
