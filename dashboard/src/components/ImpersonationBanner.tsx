/**
 * Persistent banner on the customer dashboard when an impersonation token is
 * in flight.
 *
 * Flow:
 *   1. Admin navigates to app.helloautoflow.com/?impersonate=<jwt>
 *   2. This component (mounted near the app root) detects the param, validates
 *      via /api/impersonation/verify, persists the verified state to
 *      sessionStorage so navigation within the session doesn't re-validate.
 *   3. Renders a sticky banner with countdown and "End session" button.
 *
 * The companion read-only gate (separate file, e.g. apiClient interceptor)
 * reads `getImpersonationState()` and rejects every non-GET request when
 * impersonation is active.
 */

import { useEffect, useState } from "react";

const STORAGE_KEY = "autoflow-impersonation-state";

export interface ImpersonationState {
  token: string;
  impersonated_user_id: string;
  impersonator_user_id: string;
  session_id: string;
  ends_at: string;
  mode: "read_only";
}

let cached: ImpersonationState | null | undefined;

export function getImpersonationState(): ImpersonationState | null {
  if (cached !== undefined) return cached;
  if (typeof window === "undefined") {
    cached = null;
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cached = null;
      return null;
    }
    const parsed = JSON.parse(raw) as ImpersonationState;
    if (new Date(parsed.ends_at).getTime() <= Date.now()) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      cached = null;
      return null;
    }
    cached = parsed;
    return parsed;
  } catch {
    cached = null;
    return null;
  }
}

export function endImpersonation(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_KEY);
  cached = null;
  // Strip ?impersonate from the URL and force a clean reload so the banner
  // disappears and React Query refetches against the real user.
  const url = new URL(window.location.href);
  url.searchParams.delete("impersonate");
  window.location.href = url.toString();
}

function fmtRemaining(endsAt: string): string {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ImpersonationBanner() {
  const [state, setState] = useState<ImpersonationState | null>(null);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Pick up the token from the URL on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("impersonate");
    if (!token) {
      setState(getImpersonationState());
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/impersonation/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(`Invalid impersonation token: ${(body as { reason?: string }).reason ?? res.status}`);
          return;
        }
        const verified = (await res.json()) as {
          impersonated_user_id: string;
          impersonator_user_id: string;
          session_id: string;
          ends_at: string;
          mode: "read_only";
        };
        const persist: ImpersonationState = { ...verified, token };
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
        cached = persist;
        setState(persist);
        // Strip the URL param so refreshes/back-navigation don't re-verify
        // and the token doesn't show in the browser history.
        const url = new URL(window.location.href);
        url.searchParams.delete("impersonate");
        window.history.replaceState({}, "", url.toString());
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  // Tick once per second to update the countdown.
  useEffect(() => {
    if (!state) return;
    const handle = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(handle);
  }, [state]);

  // Auto-end on expiry.
  useEffect(() => {
    if (!state) return;
    if (new Date(state.ends_at).getTime() <= Date.now()) {
      endImpersonation();
    }
  }, [state, tick]);

  if (error) {
    return (
      <div
        role="alert"
        style={{
          background: "#fde2e1",
          color: "#6a1d1a",
          padding: "0.75rem 1rem",
          borderBottom: "1px solid #f5b5b3",
          position: "sticky",
          top: 0,
          zIndex: 1000,
        }}
      >
        {error}
      </div>
    );
  }

  if (!state) return null;

  return (
    <div
      role="alert"
      style={{
        background: "#fff3cd",
        color: "#5c4400",
        padding: "0.5rem 1rem",
        borderBottom: "2px solid #ffe69c",
        display: "flex",
        gap: "1rem",
        alignItems: "center",
        position: "sticky",
        top: 0,
        zIndex: 1000,
        fontSize: "0.9rem",
      }}
    >
      <strong>Impersonating user {state.impersonated_user_id.slice(0, 8)}…</strong>
      <span>· {state.mode}</span>
      <span>· ends in {fmtRemaining(state.ends_at)}</span>
      <span style={{ marginLeft: "auto" }}>
        <button
          onClick={endImpersonation}
          style={{
            background: "#5c4400",
            color: "#ffffff",
            border: "none",
            borderRadius: 4,
            padding: "0.25rem 0.75rem",
          }}
        >
          End session
        </button>
      </span>
    </div>
  );
}
