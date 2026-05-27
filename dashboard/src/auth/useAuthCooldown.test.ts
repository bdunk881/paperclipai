import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthCooldown } from "./useAuthCooldown";

const STORAGE_KEY = "autoflow.test.cooldown";

describe("useAuthCooldown (HEL-284)", () => {
  beforeEach(() => {
    window.sessionStorage.removeItem(STORAGE_KEY);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.sessionStorage.removeItem(STORAGE_KEY);
  });

  it("is inactive on mount when no cooldown is stored", () => {
    const { result } = renderHook(() => useAuthCooldown(STORAGE_KEY, 60));
    expect(result.current.active).toBe(false);
    expect(result.current.remainingSeconds).toBe(0);
  });

  it("activates when start() is called and persists to sessionStorage", () => {
    const { result } = renderHook(() => useAuthCooldown(STORAGE_KEY, 60));
    act(() => result.current.start());
    expect(result.current.active).toBe(true);
    expect(result.current.remainingSeconds).toBeGreaterThan(0);
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(Number.parseInt(stored!, 10)).toBeGreaterThan(Date.now());
  });

  it("ticks down each second and clears when the window elapses", () => {
    const { result } = renderHook(() => useAuthCooldown(STORAGE_KEY, 3));
    act(() => result.current.start());
    expect(result.current.remainingSeconds).toBe(3);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.remainingSeconds).toBe(2);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.active).toBe(false);
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("hydrates from sessionStorage on mount so cooldown survives reload", () => {
    window.sessionStorage.setItem(STORAGE_KEY, String(Date.now() + 30_000));
    const { result } = renderHook(() => useAuthCooldown(STORAGE_KEY, 60));
    expect(result.current.active).toBe(true);
    // Allow 1s slop for the Math.ceil rounding boundary.
    expect(result.current.remainingSeconds).toBeGreaterThanOrEqual(29);
    expect(result.current.remainingSeconds).toBeLessThanOrEqual(30);
  });

  it("ignores expired cooldowns left in sessionStorage", () => {
    window.sessionStorage.setItem(STORAGE_KEY, String(Date.now() - 5_000));
    const { result } = renderHook(() => useAuthCooldown(STORAGE_KEY, 60));
    expect(result.current.active).toBe(false);
  });

  it("uses the override duration when start(seconds) is called", () => {
    const { result } = renderHook(() => useAuthCooldown(STORAGE_KEY, 60));
    act(() => result.current.start(10));
    expect(result.current.remainingSeconds).toBe(10);
  });
});
