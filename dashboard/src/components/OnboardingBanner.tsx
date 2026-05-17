/**
 * OnboardingBanner (UX-11) — friendly 3-step explainer that appears
 * on /home for first-time visitors with an empty workspace. Auto-
 * hides once the user has any agent or any mission, and is also
 * permanently dismissable via the × button (localStorage flag).
 *
 * Behavior:
 *   - Only renders when `show === true`. The Dashboard hides it once
 *     the workspace has any agents OR missions.
 *   - Dismissal via × writes `af2-onboarding-dismissed-v1=1` to
 *     localStorage so it stays hidden on subsequent visits even if
 *     the user later wipes their team.
 *   - Step indicators are pure visual scaffolding (no progress
 *     tracking yet) — the CTAs go straight to the actions the
 *     numbers describe.
 *
 * Versioning: the localStorage key has a `-v1` suffix so future
 * onboarding pass redesigns can bump the key and force the banner
 * back into view without breaking returning users' dismissals.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Sparkles, Users, X } from "lucide-react";

const DISMISS_KEY = "af2-onboarding-dismissed-v1";

interface Props {
  /**
   * Whether the workspace is empty (no agents AND no missions).
   * Caller computes this so the banner stays a presentation-only
   * component and stays testable.
   */
  show: boolean;
  /** Owner's first name, for personalization in the headline. */
  firstName: string;
}

export function OnboardingBanner({ show, firstName }: Props) {
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());

  if (!show || dismissed) return null;

  function handleDismiss(): void {
    setDismissed(true);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(DISMISS_KEY, "1");
      } catch {
        // Quota / private-mode failures are fine — banner stays
        // hidden for the session via the React state above.
      }
    }
  }

  return (
    <div
      role="region"
      aria-label="Onboarding guide"
      style={{
        position: "relative",
        marginBottom: 22,
        padding: "20px 22px",
        borderRadius: 14,
        background:
          "linear-gradient(135deg, rgba(192,84,76,0.06), rgba(90,122,90,0.06))",
        border: "1px solid rgba(192,84,76,0.20)",
      }}
    >
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss onboarding guide"
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          border: "none",
          background: "transparent",
          padding: 6,
          color: "var(--af2-muted)",
          cursor: "pointer",
          borderRadius: 6,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--af2-ink)";
          e.currentTarget.style.background = "rgba(0,0,0,0.04)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--af2-muted)";
          e.currentTarget.style.background = "transparent";
        }}
      >
        <X size={16} />
      </button>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <Sparkles size={14} style={{ color: "var(--af2-clay)" }} />
        <span
          className="af2-eyebrow"
          style={{ color: "var(--af2-clay)" }}
        >
          Welcome{firstName ? `, ${firstName}` : ""}
        </span>
      </div>
      <h2
        className="af2-h2 font-af2-serif"
        style={{
          margin: 0,
          fontSize: 22,
          lineHeight: 1.3,
          marginBottom: 6,
        }}
      >
        AutoFlow runs a team for you. Here's how to start.
      </h2>
      <p
        className="af2-muted"
        style={{
          fontSize: 13,
          lineHeight: 1.55,
          marginTop: 0,
          marginBottom: 16,
          maxWidth: 640,
        }}
      >
        Tell us what you need done. We'll draft the team. You confirm.
        They run. You watch.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Step
          number={1}
          title="Brief a mission"
          body="One paragraph. What needs to happen. We'll suggest a team to run it."
        />
        <Step
          number={2}
          title="Confirm the team"
          body="Tweak who you're hiring, edit their job descriptions, then provision."
        />
        <Step
          number={3}
          title="Watch them work"
          body="Live status. Check in or hand off new work whenever you need."
        />
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link
          to="/hire"
          className="af2-btn af2-btn-clay"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          Brief your first mission
          <ArrowRight size={14} />
        </Link>
        <Link
          to="/workspace/org-structure"
          className="af2-btn af2-btn-ghost"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Users size={14} />
          See an empty team
        </Link>
      </div>
    </div>
  );
}

function Step({
  number,
  title,
  body,
}: {
  number: number;
  title: string;
  body: string;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 10,
        background: "var(--af2-card)",
        border: "1px solid var(--af2-line)",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "var(--af2-clay-soft)",
          color: "var(--af2-clay-2, var(--af2-clay))",
          fontWeight: 700,
          fontSize: 12,
          fontFamily:
            "var(--af2-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
          flexShrink: 0,
        }}
      >
        {number}
      </span>
      <div>
        <div
          style={{
            fontWeight: 600,
            fontSize: 13.5,
            color: "var(--af2-ink)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {title}
        </div>
        <div
          className="af2-muted"
          style={{ fontSize: 12, lineHeight: 1.5, marginTop: 2 }}
        >
          {body}
        </div>
      </div>
    </div>
  );
}

function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

// Exported for tests + the rare case we want to programmatically
// re-surface the banner (e.g. a "Show onboarding again" link in Settings).
export const ONBOARDING_DISMISS_KEY = DISMISS_KEY;

// Re-export a few icons used elsewhere so consumers don't import
// from this module for unrelated reasons. (No-op pass through.)
export type { } from "lucide-react";

// Reference one of the imports to keep tree-shakers honest in case
// some future refactor drops the in-line usage. CheckCircle2 used
// previously was removed; this is a marker for future steps that
// might want a completed state.
void CheckCircle2;
