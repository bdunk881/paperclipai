/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getApiBasePath } from "../api/baseUrl";
import { trackedFetch } from "../api/trackedFetch";
import { useAuth } from "./AuthContext";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const THEME_MODE_STORAGE_KEY = "autoflow.themeMode";
const THEME_TOGGLE_FEATURE_STORAGE_KEY = "autoflow.themeToggleBeta";
const THEME_PREFERENCE_KEY = "themeMode";
const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

type PreferencesPayload = { themeMode?: ThemeMode } & Record<string, unknown>;

interface ThemeContextValue {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode: (next: ThemeMode) => void;
  loading: boolean;
  featureEnabled: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const fallbackThemeContext: ThemeContextValue = {
  mode: "system",
  resolvedTheme: "light",
  setMode: () => {},
  loading: false,
  featureEnabled: false,
};

function coerceThemeMode(value: unknown): ThemeMode | null {
  if (value === "light" || value === "dark" || value === "system") return value;
  return null;
}

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    return coerceThemeMode(window.localStorage.getItem(THEME_MODE_STORAGE_KEY)) ?? "system";
  } catch {
    return "system";
  }
}

function writeStoredMode(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  } catch {
    // localStorage can be unavailable in hardened browser contexts.
  }
}

function readSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? "dark" : "light";
}

function readFeatureFlag(): boolean {
  const envValue =
    typeof import.meta !== "undefined"
      ? (import.meta as unknown as { env?: { VITE_AF2_THEME_TOGGLE_BETA?: string } }).env
          ?.VITE_AF2_THEME_TOGGLE_BETA
      : undefined;
  if (envValue === "false") return false;
  if (envValue === "true") return true;

  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(THEME_TOGGLE_FEATURE_STORAGE_KEY);
    if (stored === "false") return false;
    if (stored === "true") return true;
  } catch {
    // Fall through to default-on beta visibility.
  }
  return true;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { getAccessToken, user } = useAuth();
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => readSystemTheme());
  const [loading, setLoading] = useState<boolean>(true);
  const [featureEnabled] = useState<boolean>(() => readFeatureFlag());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(DARK_MEDIA_QUERY);
    const onChange = () => setSystemTheme(media.matches ? "dark" : "light");

    onChange();
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

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
        const stored = coerceThemeMode(body.preferences?.[THEME_PREFERENCE_KEY]);
        if (!cancelled && stored) {
          setModeState(stored);
          writeStoredMode(stored);
        }
      } catch {
        // Swallow — localStorage/system preference remains the safe fallback.
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
    (next: ThemeMode) => {
      setModeState(next);
      writeStoredMode(next);

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
            body: JSON.stringify({ preferences: { [THEME_PREFERENCE_KEY]: next } }),
          });
        } catch {
          // Ignore — next successful load/PATCH reconciles the server copy.
        }
      })();
    },
    [getAccessToken],
  );

  const resolvedTheme: ResolvedTheme = mode === "system" ? systemTheme : mode;

  useEffect(() => {
    const root = document.documentElement;
    if (featureEnabled && resolvedTheme === "dark") {
      root.setAttribute("data-theme", "dark");
      root.style.colorScheme = "dark";
    } else {
      root.removeAttribute("data-theme");
      root.style.colorScheme = "light";
    }
  }, [featureEnabled, resolvedTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolvedTheme, setMode, loading, featureEnabled }),
    [mode, resolvedTheme, setMode, loading, featureEnabled],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  return ctx ?? fallbackThemeContext;
}

