import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getMfaPolicy, type MfaPolicy } from "../api/mfaApi";

type PolicyState =
  | { status: "loading" }
  | { status: "ready"; policy: MfaPolicy }
  | { status: "error"; message: string };

const errorWrapStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "60vh",
  padding: 24,
};

const errorCardStyle: CSSProperties = {
  maxWidth: 420,
  textAlign: "center",
  border: "1px solid rgba(0,0,0,.12)",
  borderRadius: 8,
  padding: 24,
};

function isDevBypassEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("autoflow.mfa.enforcement") === "off";
  } catch {
    return false;
  }
}

export function MfaEnforcementGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [state, setState] = useState<PolicyState>({ status: "loading" });
  const [retryCounter, setRetryCounter] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void (async () => {
      try {
        const policy = await getMfaPolicy();
        if (!cancelled) setState({ status: "ready", policy });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Could not check MFA status.";
        setState({ status: "error", message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [retryCounter]);

  if (location.pathname.startsWith("/onboarding/mfa")) {
    return <>{children}</>;
  }

  if (isDevBypassEnabled()) {
    return <>{children}</>;
  }

  if (state.status === "loading") {
    return <div className="muted">Checking MFA…</div>;
  }

  if (state.status === "error") {
    // Fail CLOSED. This gate protects the platform-admin console; if we
    // can't confirm the caller's MFA status we must NOT render the
    // protected shell (the old "render children on error" behavior is what
    // let HEL-313 silently bypass enforcement). Block with a retry instead.
    return (
      <div className="mfa-gate-error" role="alert" style={errorWrapStyle}>
        <div style={errorCardStyle}>
          <h2 style={{ margin: "0 0 8px" }}>Can&rsquo;t verify MFA</h2>
          <p className="muted" style={{ margin: "0 0 16px" }}>
            We couldn&rsquo;t confirm your two-factor status, so the admin
            console is locked until the check succeeds.
          </p>
          <p className="muted" style={{ margin: "0 0 16px", fontSize: 12 }}>
            {state.message}
          </p>
          <button onClick={() => setRetryCounter((n) => n + 1)}>Retry</button>
        </div>
      </div>
    );
  }

  if (!state.policy.hasAnyFactor) {
    return (
      <Navigate
        to="/onboarding/mfa"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }

  return <>{children}</>;
}
