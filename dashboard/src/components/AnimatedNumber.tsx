/**
 * Animated number — tweens from the previous render's value to the next
 * over a short window. Used by the home dashboard stat tiles so changes
 * surfaced by polling are noticed.
 */
import { useEffect, useRef, useState } from "react";

interface AnimatedNumberProps {
  value: number;
  /** How long the tween takes, in ms. */
  durationMs?: number;
  /** Locale-aware integer formatter. Defaults to plain rounding. */
  format?: (value: number) => string;
}

const DEFAULT_DURATION = 480;

export function AnimatedNumber({
  value,
  durationMs = DEFAULT_DURATION,
  format,
}: AnimatedNumberProps) {
  const [displayed, setDisplayed] = useState(value);
  const fromRef = useRef(value);
  const startedAtRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // First mount: jump.
    if (startedAtRef.current === null) {
      fromRef.current = value;
      setDisplayed(value);
      startedAtRef.current = -1;
      return;
    }
    if (value === displayed) return;
    fromRef.current = displayed;
    startedAtRef.current = performance.now();

    function tick(now: number) {
      const start = startedAtRef.current ?? now;
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      const current = fromRef.current + (value - fromRef.current) * eased;
      setDisplayed(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return <>{format ? format(displayed) : Math.round(displayed)}</>;
}
