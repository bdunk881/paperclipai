/**
 * Hard-cutover MFA enrollment gate (HEL-mfa, hardened in HEL-389).
 *
 * Wraps `PrivateRoute` so an authenticated user without ANY MFA factor is
 * redirected to `/onboarding/mfa` before they can reach a protected route.
 * Per the project decision: no grace period for existing users — first
 * login after MFA ships forces enrollment.
 *
 * HEL-389: this is a HARD gate. When enrollment is required we render a
 * `<Navigate>` to the standalone wizard (mounted under `AuthOnlyRoute`, with
 * no `<Layout/>`), so the dashboard — and its global Ctrl/⌘+K command
 * palette — never mount. The previous design (HEL-281) rendered the
 * dashboard behind a dismissible scrim, which let a user reach the app via
 * the command palette / Tab focus before enrolling. Rendering children at
 * all while a factor is missing is the bug; we redirect instead.
 *
 * Behavior:
 *   - While the policy is loading, render nothing (no flash to onboarding).
 *   - DEV ONLY: if `localStorage["autoflow.mfa.enforcement"] === "off"`, skip
 *     the gate (manual console escape hatch for local work). The flag is
 *     ignored in production builds — the gate cannot be skipped client-side.
 *   - If policy requires app MFA and the user has no factor → redirect to
 *     `/onboarding/mfa` with `state.from` so the wizard can bounce back to
 *     the original target on completion.
 *   - On a policy-fetch error, fail open (render children): a transient
 *     `/api/mfa/policy` outage must not lock users out of the whole app, and
 *     the server's `requireAAL2` still gates every sensitive action.
 *   - Once the user enrolls, the wizard navigates back to `from`; the gate
 *     remounts on that route, re-fetches policy, sees a factor, and renders
 *     children.
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
  // Honored only in dev builds. In production the gate cannot be skipped
  // client-side via this flag (HEL-389).
  if (!import.meta.env.DEV) return false;
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
  }, [userId, requireAccessToken]);

  // Pages that ARE the enrollment / challenge flow must not be wrapped by
  // the gate or they'd redirect-loop. The router only mounts the gate on
  // protected app routes (and `/onboarding/mfa` is an `AuthOnlyRoute`), but
  // defensively short-circuit anyway.
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

  // HEL-280: the server tells us whether app-side MFA is required for this
  // session. OAuth users come back with requiresAppMfa=false (unless their
  // workspace flipped the override flag on), so we skip enrollment for them.
  // Any user who DOES require app MFA but has no factor is hard-redirected
  // to the standalone enrollment wizard — the dashboard never mounts until a
  // factor exists (HEL-389).
  if (state.policy.requiresAppMfa && !state.policy.hasAnyFactor) {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/onboarding/mfa" state={{ from }} replace />;
  }

  return <>{children}</>;
}
