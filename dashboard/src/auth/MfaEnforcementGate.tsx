/**
 * Hard-cutover MFA enrollment gate (HEL-mfa).
 *
 * Wraps `PrivateRoute` so authenticated users without ANY MFA factor are
 * redirected to `/onboarding/mfa` before they can reach a protected route.
 * Per the project decision: no grace period for existing users — first
 * login after MFA ships forces enrollment.
 *
 * Behavior:
 *   - While the policy is loading, render nothing (no flash to onboarding).
 *   - If `MFA_ENFORCEMENT_DISABLED` is set in localStorage (dev escape
 *     hatch — set manually in the console), skip the gate.
 *   - If policy.hasAnyFactor is false → redirect to /onboarding/mfa with
 *     `state.from` so the wizard can bounce back to the original target.
 *   - Once the user has enrolled, the wizard's success handler invalidates
 *     the policy query and the gate becomes a no-op.
 */

import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getMfaPolicy, type MfaPolicy } from "../api/mfaApi";
import { useAuth } from "../context/AuthContext";

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

export function MfaEnforcementGate({ children }: { children: React.ReactNode }) {
  const { user, requireAccessToken } = useAuth();
  const location = useLocation();
  const [state, setState] = useState<PolicyState>({ status: "loading" });

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await requireAccessToken();
        const policy = await getMfaPolicy(token);
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
  }, [user, requireAccessToken]);

  // Pages that ARE the enrollment / challenge flow must not be wrapped by
  // the gate or they'd redirect-loop. The router only mounts the gate on
  // protected app routes, but defensively short-circuit anyway.
  if (location.pathname.startsWith("/onboarding/mfa")) {
    return <>{children}</>;
  }

  if (isDevBypassEnabled()) {
    return <>{children}</>;
  }

  if (state.status === "loading") {
    return null;
  }

  if (state.status === "error") {
    // Fail open on a policy fetch error rather than locking the user out of
    // their dashboard during a transient outage — the next request that
    // hits a `requireAAL2`-gated endpoint will surface the step-up modal.
    return <>{children}</>;
  }

  // HEL-280: the server now tells us whether app-side MFA is required
  // for this session. OAuth users come back with requiresAppMfa=false
  // (unless their workspace flipped the override flag on), so we skip
  // the enrollment redirect for them. Password/magic-link users still
  // hit the gate.
  if (state.policy.requiresAppMfa && !state.policy.hasAnyFactor) {
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
