/**
 * useHomeFilters — workspace-scoped, localStorage-persisted filters
 * shared by every tile + chart on the home dashboard.
 *
 *  - Mission scope: a specific mission id, or `null` for "all missions".
 *  - Date range: a preset (today / 7d / 30d) or a custom [start, end]
 *    pair. End defaults to "now" so we can render up-to-the-minute
 *    charts without writing a future date.
 *
 * Defaults are remembered so the next visit picks up where the user
 * left off. Switching workspaces resets the preferences (they're
 * meaningless cross-workspace).
 */
import { useCallback, useEffect, useMemo, useState } from "react";

export type HomeRangePreset = "today" | "7d" | "30d" | "custom";

export interface HomeDateRange {
  preset: HomeRangePreset;
  /** ISO start. */
  start: string;
  /** ISO end. */
  end: string;
}

export interface HomeFilters {
  missionId: string | null;
  range: HomeDateRange;
}

export interface UseHomeFiltersResult {
  filters: HomeFilters;
  setMissionId: (missionId: string | null) => void;
  setRangePreset: (preset: Exclude<HomeRangePreset, "custom">) => void;
  setCustomRange: (start: string, end: string) => void;
}

const STORAGE_PREFIX = "af2.home.filters.v1";

function startOfToday(): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function nowIso(): string {
  return new Date().toISOString();
}

export function rangeFromPreset(
  preset: Exclude<HomeRangePreset, "custom">,
): HomeDateRange {
  if (preset === "today") return { preset, start: startOfToday(), end: nowIso() };
  if (preset === "7d") return { preset, start: daysAgo(7), end: nowIso() };
  return { preset, start: daysAgo(30), end: nowIso() };
}

function defaultFilters(): HomeFilters {
  return { missionId: null, range: rangeFromPreset("today") };
}

function loadFilters(workspaceId: string | null): HomeFilters {
  if (typeof window === "undefined" || !workspaceId) return defaultFilters();
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}.${workspaceId}`);
    if (!raw) return defaultFilters();
    const parsed = JSON.parse(raw) as Partial<HomeFilters>;
    const fallback = defaultFilters();
    const missionId =
      typeof parsed.missionId === "string" || parsed.missionId === null
        ? parsed.missionId
        : fallback.missionId;
    const preset =
      parsed.range?.preset === "today" ||
      parsed.range?.preset === "7d" ||
      parsed.range?.preset === "30d" ||
      parsed.range?.preset === "custom"
        ? parsed.range.preset
        : fallback.range.preset;
    let range: HomeDateRange;
    if (preset === "custom") {
      range = {
        preset: "custom",
        start: parsed.range?.start ?? fallback.range.start,
        end: parsed.range?.end ?? fallback.range.end,
      };
    } else {
      // Re-derive presets relative to "now" so they always reflect the
      // current day boundary rather than a stale frozen-at-save value.
      range = rangeFromPreset(preset);
    }
    return { missionId, range };
  } catch {
    return defaultFilters();
  }
}

function saveFilters(workspaceId: string | null, filters: HomeFilters): void {
  if (typeof window === "undefined" || !workspaceId) return;
  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}.${workspaceId}`,
      JSON.stringify(filters),
    );
  } catch {
    /* ignore quota errors */
  }
}

export function useHomeFilters(
  workspaceId: string | null,
): UseHomeFiltersResult {
  const [filters, setFilters] = useState<HomeFilters>(() =>
    loadFilters(workspaceId),
  );

  // Reload from storage when the workspace switches — keeps preferences
  // workspace-scoped without leaking from one to another.
  useEffect(() => {
    setFilters(loadFilters(workspaceId));
  }, [workspaceId]);

  // Re-derive the "today / 7d / 30d" end-of-range every minute so the
  // sparklines + charts visually progress without a manual refresh.
  useEffect(() => {
    if (filters.range.preset === "custom") return;
    const id = window.setInterval(() => {
      setFilters((prev) => {
        if (prev.range.preset === "custom") return prev;
        return { ...prev, range: rangeFromPreset(prev.range.preset) };
      });
    }, 60_000);
    return () => window.clearInterval(id);
  }, [filters.range.preset]);

  const setMissionId = useCallback(
    (missionId: string | null) => {
      setFilters((prev) => {
        const next = { ...prev, missionId };
        saveFilters(workspaceId, next);
        return next;
      });
    },
    [workspaceId],
  );

  const setRangePreset = useCallback(
    (preset: Exclude<HomeRangePreset, "custom">) => {
      setFilters((prev) => {
        const next = { ...prev, range: rangeFromPreset(preset) };
        saveFilters(workspaceId, next);
        return next;
      });
    },
    [workspaceId],
  );

  const setCustomRange = useCallback(
    (start: string, end: string) => {
      setFilters((prev) => {
        const next: HomeFilters = {
          ...prev,
          range: { preset: "custom", start, end },
        };
        saveFilters(workspaceId, next);
        return next;
      });
    },
    [workspaceId],
  );

  return useMemo(
    () => ({ filters, setMissionId, setRangePreset, setCustomRange }),
    [filters, setMissionId, setRangePreset, setCustomRange],
  );
}

// Helpers exposed for components that need to filter data themselves.
export function isWithinRange(iso: string | null | undefined, range: HomeDateRange): boolean {
  if (!iso) return false;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return false;
  return ts >= new Date(range.start).getTime() && ts <= new Date(range.end).getTime();
}

export function isAgentOnMission(missionId: string | null, agentMissionId: string | null | undefined): boolean {
  if (!missionId) return true;
  return agentMissionId === missionId;
}
