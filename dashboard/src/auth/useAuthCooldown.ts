/**
 * `useAuthCooldown` — sessionStorage-backed countdown for email-sending forms
 * (magic link, password reset). Per [HEL-284].
 *
 * Supabase's built-in SMTP enforces a project-wide 2-emails-per-hour cap and
 * does not return a `Retry-After`. Without a client guard, a fat-fingered
 * double-click burns the project quota and every user in the project sees
 * "Too many attempts" until the bucket refills. This hook prevents that by
 * disabling the Send button for a fixed window after each send.
 *
 * The cooldown persists in `sessionStorage` so it survives in-tab reload but
 * not a browser restart — a fresh visitor shouldn't be punished for a
 * previous user's clicks.
 */

import { useCallback, useEffect, useState } from "react";

const DEFAULT_DURATION_SECONDS = 60;

function nowMs(): number {
  return Date.now();
}

function readStoredUntil(storageKey: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > nowMs() ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeStoredUntil(storageKey: string, untilMs: number): void {
  if (typeof window === "undefined") return;
  try {
    if (untilMs <= nowMs()) {
      window.sessionStorage.removeItem(storageKey);
    } else {
      window.sessionStorage.setItem(storageKey, String(untilMs));
    }
  } catch {
    // sessionStorage can throw (Safari private mode, quota). Cooldown then
    // is in-memory only for this tab — still better than no guard at all.
  }
}

export interface AuthCooldown {
  remainingSeconds: number;
  active: boolean;
  start: (durationSeconds?: number) => void;
}

export function useAuthCooldown(
  storageKey: string,
  durationSeconds: number = DEFAULT_DURATION_SECONDS,
): AuthCooldown {
  const [untilMs, setUntilMs] = useState<number>(() => readStoredUntil(storageKey));
  const [, forceTick] = useState(0);

  useEffect(() => {
    const stored = readStoredUntil(storageKey);
    if (stored !== untilMs) {
      setUntilMs(stored);
    }
    // Only run on storageKey change — mount-time hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (untilMs <= nowMs()) return;
    const interval = window.setInterval(() => {
      if (untilMs <= nowMs()) {
        setUntilMs(0);
        writeStoredUntil(storageKey, 0);
      } else {
        forceTick((n) => n + 1);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [untilMs, storageKey]);

  const start = useCallback(
    (override?: number) => {
      const seconds = override ?? durationSeconds;
      const next = nowMs() + seconds * 1000;
      setUntilMs(next);
      writeStoredUntil(storageKey, next);
    },
    [durationSeconds, storageKey],
  );

  const remainingMs = Math.max(0, untilMs - nowMs());
  return {
    remainingSeconds: Math.ceil(remainingMs / 1000),
    active: remainingMs > 0,
    start,
  };
}
