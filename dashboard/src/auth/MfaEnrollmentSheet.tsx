/**
 * Global MFA enrollment overlay (HEL-281).
 *
 * Mounted once at the App root next to `<MfaStepUpModal>`. Listens for
 * `autoflow:mfa:enrollment-required` from the enforcement gate; opens a
 * right-side sheet over the dashboard while the user enrolls a factor.
 * On completion, emits `autoflow:mfa:enrollment-completed` so the gate
 * can re-fetch policy and unblock the page.
 *
 * Why an overlay, not a route?
 *   - The old `<Navigate to="/onboarding/mfa">` left the user staring
 *     at an empty page with no app chrome — felt broken.
 *   - The sheet keeps the dashboard visible behind a scrim. The user
 *     sees what they're about to access, which reads as "do this now,
 *     then keep going" instead of "you must answer this to proceed."
 *
 * Dismissal: the sheet cannot be closed by Escape, scrim click, or
 * route navigation. Enrollment is mandatory for password / magic-link
 * users; the only way out is to complete the flow (or the OAuth bypass
 * from HEL-280, which means the gate never emits in the first place).
 */

import { useEffect, useState, type CSSProperties } from "react";
import { ShieldCheck } from "lucide-react";
import { MfaEnrollmentFlow } from "./MfaEnrollmentFlow";
import {
  ENROLLMENT_REQUIRED_EVENT,
  emitEnrollmentCompleted,
} from "./enrollmentEvents";

const MOBILE_BREAKPOINT_PX = 768;

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`).matches,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    const handler = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

export function MfaEnrollmentSheet() {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(ENROLLMENT_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(ENROLLMENT_REQUIRED_EVENT, handler);
  }, []);

  function handleComplete() {
    setOpen(false);
    emitEnrollmentCompleted();
  }

  if (!open) return null;

  // Desktop: right-side sheet (~440px). Mobile: centered modal taking
  // most of the viewport. Both share the same scrim + content card.
  const scrimStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    background: "rgba(26, 20, 16, 0.32)",
    backdropFilter: "blur(2px)",
    display: "flex",
    alignItems: isMobile ? "center" : "stretch",
    justifyContent: isMobile ? "center" : "flex-end",
    padding: isMobile ? 16 : 0,
  };

  const cardStyle: CSSProperties = isMobile
    ? {
        background: "var(--af2-paper)",
        borderRadius: 14,
        border: "1px solid var(--af2-line)",
        width: "100%",
        maxWidth: 520,
        maxHeight: "calc(100vh - 32px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }
    : {
        background: "var(--af2-paper)",
        borderLeft: "1px solid var(--af2-line)",
        width: 440,
        maxWidth: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        boxShadow: "-18px 0 40px rgba(26, 20, 16, 0.12)",
      };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mfa-enrollment-sheet-title"
      style={scrimStyle}
      // Note: NO onClick handler — the sheet is intentionally
      // non-dismissible by scrim. The user must complete enrollment.
    >
      <div style={cardStyle}>
        <div
          style={{
            padding: "18px 22px 12px",
            borderBottom: "1px solid var(--af2-line)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <ShieldCheck size={18} className="text-af2-sage" />
          <div>
            <div
              className="af2-eyebrow"
              style={{ marginBottom: 2 }}
            >
              Required · Account security
            </div>
            <div
              id="mfa-enrollment-sheet-title"
              className="af2-h2 font-af2-serif"
              style={{ lineHeight: 1.15 }}
            >
              Set up two-factor auth
            </div>
          </div>
        </div>
        <div style={{ padding: "18px 22px", overflowY: "auto", flex: 1 }}>
          <p className="text-sm text-af2-ink-4 mb-4">
            AutoFlow protects every account with a phish-resistant second factor. Choose a
            passkey (recommended) or an authenticator app, then save your recovery codes.
          </p>
          <MfaEnrollmentFlow onComplete={handleComplete} />
        </div>
      </div>
    </div>
  );
}
