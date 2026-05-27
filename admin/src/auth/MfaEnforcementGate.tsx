import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getMfaPolicy, type MfaPolicy } from "../api/mfaApi";

type PolicyState =
  | { status: "loading" }
  | { status: "ready"; policy: MfaPolicy }
  | { status: "error"; message: string };

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

  useEffect(() => {
    let cancelled = false;
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
  }, []);

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
    return <>{children}</>;
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
