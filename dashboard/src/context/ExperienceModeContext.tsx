import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { trackedFetch } from "../api/trackedFetch";
import { getApiBasePath } from "../api/baseUrl";
import { useAuth } from "./AuthContext";

/**
 * ExperienceModeContext (HEL-203 / PR 1).
 *
 * Holds the user's chosen interface mode — `"simple"` (Hire-style guided
 * surfaces) or `"pro"` (full power-user toolset). Every consolidated v2
 * surface reads this to decide whether to expose Pro-only tabs, advanced
 * filters, and raw JSON / trace panes.
 *
 * Persistence: PATCH /api/user-profile/preferences with `{preferences}`
 * (see migrations/058 + src/user/profileRoutes.ts). We optimistically
 * update local state first, then fire-and-forget the server write — if it
 * fails we surface nothing (the next page load will reconcile from the
 * server's GET). This matches the latency budget the v2 design assumes
 * (sub-100ms toggle).
 *
 * Initial mode: `"simple"` until the server returns a stored preference.
 * We intentionally do not read localStorage as a cache here — multi-device
 * users would see stale modes on first paint; the server roundtrip is
 * cheap enough to wait one tick.
 */

export type ExperienceMode = "simple" | "pro";

interface ExperienceModeContextValue {
  mode: ExperienceMode;
  setMode: (next: ExperienceMode) => void;
  /** True until the initial GET completes. UI may render either way. */
  loading: boolean;
}

const ExperienceModeContext = createContext<ExperienceModeContextValue | null>(null);

type PreferencesPayload = { experienceMode?: ExperienceMode } & Record<string, unknown>;

function coerceMode(value: unknown): ExperienceMode | null {
  if (value === "simple" || value === "pro") return value;
  return null;
}

export function ExperienceModeProvider({ children }: { children: React.ReactNode }) {
  const { getAccessToken, user } = useAuth();
  const [mode, setModeState] = useState<ExperienceMode>("simple");
  const [loading, setLoading] = useState<boolean>(true);

  // Initial fetch — reconciles client state with the server-stored
  // preference. Re-runs when the authenticated user changes (login /
  // workspace switch surfaces should re-pull because preferences are
  // per-user, not per-workspace).
  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setLoading(false);
      return;
    }

    async function load() {
      try {
        const token = await getAccessToken();
        if (!token) {
          if (!cancelled) setLoading(false);
          return;
        }
        const res = await trackedFetch(`${getApiBasePath()}/user-profile/preferences`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const body = (await res.json()) as { preferences?: PreferencesPayload };
        const stored = coerceMode(body.preferences?.experienceMode);
        if (!cancelled && stored) {
          setModeState(stored);
        }
      } catch {
        // Swallow — Simple mode is a safe default. The toggle button will
        // still work; the next successful PATCH will reconcile.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken, user]);

  const setMode = useCallback(
    (next: ExperienceMode) => {
      setModeState(next);
      // Fire-and-forget persistence. Auth failures and network glitches
      // are tolerated; the next reload will rehydrate from the server.
      void (async () => {
        try {
          const token = await getAccessToken();
          if (!token) return;
          await trackedFetch(`${getApiBasePath()}/user-profile/preferences`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ preferences: { experienceMode: next } }),
          });
        } catch {
          // Ignore — see comment above.
        }
      })();
    },
    [getAccessToken],
  );

  const value = useMemo<ExperienceModeContextValue>(
    () => ({ mode, setMode, loading }),
    [mode, setMode, loading],
  );

  return (
    <ExperienceModeContext.Provider value={value}>{children}</ExperienceModeContext.Provider>
  );
}

export function useExperienceMode(): ExperienceModeContextValue {
  const ctx = useContext(ExperienceModeContext);
  if (!ctx) {
    throw new Error("useExperienceMode must be used within ExperienceModeProvider");
  }
  return ctx;
}

/**
 * useExperienceCopy — convenience helper that picks between Simple and
 * Pro copy at the consumer level. Encourages call-sites to ship both
 * variants inline (instead of forking entire components) so the diff
 * stays scannable when product tunes wording.
 *
 *   const heading = useExperienceCopy("Hire", "Recruit · pipeline");
 */
export function useExperienceCopy<T>(simple: T, pro: T): T {
  const { mode } = useExperienceMode();
  return mode === "pro" ? pro : simple;
}
