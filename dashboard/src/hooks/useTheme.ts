import { useEffect, useState } from "react";

const THEME_STORAGE_KEY = "autoflow:theme:v1";

export type ThemeMode = "light" | "dark";

const listeners = new Set<(theme: ThemeMode) => void>();
let currentTheme: ThemeMode | null = null;

function detectInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const saved = safeStorageGet(THEME_STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return safePrefersDark() ? "dark" : "light";
}

function applyTheme(theme: ThemeMode) {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  safeStorageSet(THEME_STORAGE_KEY, theme);
}

function safeStorageGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  const storage = window.localStorage as Partial<Storage> | undefined;
  if (!storage || typeof storage.getItem !== "function") return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string) {
  if (typeof window === "undefined") return;
  const storage = window.localStorage as Partial<Storage> | undefined;
  if (!storage || typeof storage.setItem !== "function") return;
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage write failures (private mode, restricted contexts, test shims).
  }
}

function safePrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function ensureThemeInitialized(): ThemeMode {
  if (currentTheme) return currentTheme;
  currentTheme = detectInitialTheme();
  applyTheme(currentTheme);
  return currentTheme;
}

function setSharedTheme(nextTheme: ThemeMode) {
  const prev = ensureThemeInitialized();
  if (prev === nextTheme) return;
  currentTheme = nextTheme;
  applyTheme(nextTheme);
  listeners.forEach((listener) => listener(nextTheme));
}

export function initializeTheme() {
  ensureThemeInitialized();
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => ensureThemeInitialized());

  useEffect(() => {
    const listener = (nextTheme: ThemeMode) => {
      setThemeState(nextTheme);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const setTheme = (nextTheme: ThemeMode) => {
    setSharedTheme(nextTheme);
  };

  function toggleTheme() {
    setSharedTheme(theme === "dark" ? "light" : "dark");
  }

  return { theme, setTheme, toggleTheme };
}
