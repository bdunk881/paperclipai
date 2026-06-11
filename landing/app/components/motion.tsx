/**
 * HEL-777 — motion primitives for the landing page.
 *
 * Research-grounded ground rules (full plan on the Linear ticket):
 * - All *visuals* live in CSS (`v2.css` "Motion" layer): compositor-only
 *   transform/opacity, no layout-property animation, one
 *   `prefers-reduced-motion` block collapses everything to final state.
 * - JS here only toggles classes and updates numbers. No animation runtime:
 *   framer-motion stays unused so the marketing page ships ~2kb of motion JS
 *   instead of an interaction library.
 * - SSR/no-JS safety: components render their *final* content on the server.
 *   Scroll-reveal hidden states are gated behind the `html.js` class (set by
 *   an inline script in root.tsx), so a no-JS visitor sees a complete page.
 */

import { createElement, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, Ref } from "react";

/**
 * Synchronous reduced-motion check for use inside effects (no state race).
 * `html.force-motion` (the `?motion=force` preview override set in root.tsx)
 * wins over the OS preference; see the v2.css reduced-motion block.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (document.documentElement.classList.contains("force-motion")) return false;
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// useInViewOnce — IntersectionObserver that latches true and disconnects.

export function useInViewOnce<T extends Element>(
  rootMargin = "0px 0px -8% 0px",
): { ref: Ref<T>; inView: boolean } {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return { ref, inView };
}

// ─────────────────────────────────────────────────────────────────────────────
// InView — renders a plain element (`as`) with `lp-io` + `in` classes so the
// CSS motion layer can run once-only, early-triggered reveal transitions on
// its children. Reveals are *transitions* (not animations) precisely so they
// never run without JS — the `.js`-gated hidden state is the only trigger.

type InViewTag = "div" | "section" | "p" | "figure" | "footer";

export function InView({
  as = "div",
  className = "",
  rootMargin,
  children,
  ...rest
}: {
  as?: InViewTag;
  className?: string;
  rootMargin?: string;
  children?: ReactNode;
  id?: string;
  style?: CSSProperties;
  "aria-label"?: string;
}) {
  const { ref, inView } = useInViewOnce<HTMLElement>(rootMargin);
  return createElement(
    as,
    {
      ref,
      className: `${className ? `${className} ` : ""}lp-io${inView ? " in" : ""}`,
      ...rest,
    },
    children,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CountUp — renders the final value on the server; counts 0 → value with an
// eased rAF loop when triggered ("view" via its own observer, or "mount" with
// a delay for load-time choreography). Reduced motion ⇒ final value, no count.

const defaultFormat = (v: number) => Math.round(v).toLocaleString("en-US");

export function CountUp({
  value,
  format = defaultFormat,
  duration = 900,
  delay = 0,
  trigger = "view",
  className,
  style,
}: {
  value: number;
  /** Maps the in-flight numeric value to display text. */
  format?: (v: number) => string;
  duration?: number;
  delay?: number;
  trigger?: "view" | "mount";
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState(() => format(value));
  // Latest-ref pattern: `format` is usually an inline lambda; re-running the
  // effect on identity change would restart the count every render.
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    let raf = 0;
    let timer = 0;
    let started = false;

    const run = () => {
      if (started) return;
      started = true;
      timer = window.setTimeout(() => {
        setText(formatRef.current(0));
        const t0 = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - t0) / duration);
          const eased = 1 - Math.pow(1 - p, 3); // cubic out
          setText(formatRef.current(value * eased));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }, delay);
    };

    let io: IntersectionObserver | undefined;
    if (trigger === "mount" || typeof IntersectionObserver === "undefined") {
      run();
    } else {
      io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              io?.disconnect();
              run();
              return;
            }
          }
        },
        { rootMargin: "0px 0px -8% 0px" },
      );
      io.observe(el);
    }

    return () => {
      io?.disconnect();
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [value, duration, delay, trigger]);

  return (
    <span
      ref={ref}
      className={className}
      // Tabular figures so the width doesn't jitter while counting.
      style={{ fontFeatureSettings: '"tnum"', ...style }}
    >
      {text}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TypeIn — the v2 prototype's unshipped `.lp-prompt` motif. Server-renders the
// full text (SEO/no-JS safe); on mount it clears and types with a blinking
// clay caret, holds the caret briefly, then hides it. Reduced motion ⇒ static.

export function TypeIn({
  text,
  speed = 34,
  delay = 0,
  caretHold = 1300,
  className,
  style,
}: {
  text: string;
  /** ms per character */
  speed?: number;
  delay?: number;
  /** how long the caret keeps blinking after typing completes (ms) */
  caretHold?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const [chars, setChars] = useState(text.length);
  const [caret, setCaret] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    let interval = 0;
    let holdTimer = 0;
    setChars(0);
    const startTimer = window.setTimeout(() => {
      setCaret(true);
      let i = 0;
      interval = window.setInterval(() => {
        i += 1;
        setChars(i);
        if (i >= text.length) {
          window.clearInterval(interval);
          holdTimer = window.setTimeout(() => setCaret(false), caretHold);
        }
      }, speed);
    }, delay);

    return () => {
      window.clearTimeout(startTimer);
      window.clearInterval(interval);
      window.clearTimeout(holdTimer);
    };
  }, [text, speed, delay, caretHold]);

  return (
    <span className={className} style={style}>
      {text.slice(0, chars)}
      {caret ? <span className="lp-caret" aria-hidden="true" /> : null}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ScrollProgressBar — 2px clay reading-progress hairline under the sticky nav.
// Mirrors the user's own scroll position (allowed under reduced motion); the
// rAF lerp smoothing is skipped for reduced-motion users.

export function ScrollProgressBar() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const instant = prefersReducedMotion();

    let target = 0;
    let current = 0;
    let raf = 0;
    let running = false;

    const step = () => {
      current += (target - current) * 0.16;
      if (Math.abs(target - current) < 0.001) {
        current = target;
        running = false;
      }
      el.style.transform = `scaleX(${current})`;
      if (running) raf = requestAnimationFrame(step);
    };

    const compute = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      target = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      if (instant) {
        current = target;
        el.style.transform = `scaleX(${current})`;
        return;
      }
      if (!running) {
        running = true;
        raf = requestAnimationFrame(step);
      }
    };

    compute();
    window.addEventListener("scroll", compute, { passive: true });
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute);
      window.removeEventListener("resize", compute);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <div ref={ref} className="lp-progress" aria-hidden="true" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Marquee — continuous logo strip. Pure CSS animation (runs without JS);
// content is duplicated for the seamless -50% loop, second copy aria-hidden.
// Reduced motion ⇒ CSS shows the first copy as a static wrapped row.

export function Marquee({
  children,
  className = "",
  duration = 36,
}: {
  children: ReactNode;
  className?: string;
  /** seconds per full loop */
  duration?: number;
}) {
  return (
    <div className={`lp-marquee${className ? ` ${className}` : ""}`}>
      <div className="lp-marquee-track" style={{ animationDuration: `${duration}s` }}>
        <div className="lp-marquee-group">{children}</div>
        <div className="lp-marquee-group" aria-hidden="true">
          {children}
        </div>
      </div>
    </div>
  );
}
