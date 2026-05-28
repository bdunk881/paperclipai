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
import { useLocation } from "react-router-dom";
import { getMfaPolicy, type MfaPolicy } from "../api/mfaApi";
import { useAuth } from "../context/AuthContext";
import {
  ENROLLMENT_COMPLETED_EVENT,
  emitEnrollmentRequired,
} from "./enrollmentEvents";

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
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Key the fetch effect on user.id (a primitive), NOT the user object
  // itself. AuthContext memoizes user in production, but defensive callers
  // (and test mocks) can hand us a fresh object reference per render,
  // which would cause the effect to re-fire forever and burn the request
  // budget.
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
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
  }, [userId, requireAccessToken, refreshCounter]);

  // HEL-281: when the global enrollment sheet completes, re-fetch policy
  // so the gate flips from "needs enrollment" to "factor present" and
  // future renders skip the emit.
  useEffect(() => {
    const handler = () => setRefreshCounter((n) => n + 1);
    window.addEventListener(ENROLLMENT_COMPLETED_EVENT, handler);
    return () => window.removeEventListener(ENROLLMENT_COMPLETED_EVENT, handler);
  }, []);

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

  // HEL-280 + HEL-281: the server tells us whether app-side MFA is
  // required for this session. OAuth users come back with
  // requiresAppMfa=false (unless their workspace flipped the override
  // flag on), so we skip the prompt. Password/magic-link users without
  // a factor get the global enrollment sheet (HEL-281) — we emit an
  // event that <MfaEnrollmentSheet> listens for, then ALWAYS render
  // children so the dashboard stays visible behind the scrim instead of
  // <Navigate>-ing to an empty page.
  return (
    <>
      <EnrollmentEmitter
        shouldEmit={state.policy.requiresAppMfa && !state.policy.hasAnyFactor}
        from={`${location.pathname}${location.search}${location.hash}`}
      />
      {children}
    </>
  );
}

/**
 * Emits the enrollment-required event exactly once per "policy says
 * enrollment needed" transition. Lives in a child component so the
 * effect's deps depend on `shouldEmit` and re-fire when the policy
 * flips. Without this split the gate would re-emit on every parent
 * render.
 */
function EnrollmentEmitter({
  shouldEmit,
  from,
}: {
  shouldEmit: boolean;
  from: string;
}) {
  useEffect(() => {
    if (!shouldEmit) return;
    emitEnrollmentRequired({ from });
  }, [shouldEmit, from]);
  return null;
}
