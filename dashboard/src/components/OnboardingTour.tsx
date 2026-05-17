/**
 * OnboardingTour (DASH-17 / HEL-136).
 *
 * First-visit guided tour with anchored tooltips. Highlights the
 * sidebar nav items the user needs to hit in order to get value out
 * of AutoFlow:
 *
 *   1. Hire — draft your first mission
 *   2. Assignments — hand work off to an agent
 *   3. Integrations — connect Slack / Gmail / Stripe / etc.
 *   4. Models — drop in an LLM key so the agents can think
 *
 * Behavior:
 *   - Shown once per browser on first dashboard load. Dismissal +
 *     completion both write a versioned localStorage flag so
 *     redesigning the tour later just means bumping the version.
 *   - Each step finds its anchor via a CSS selector (sidebar uses
 *     stable href-based selectors). If the anchor isn't on screen
 *     (mobile collapsed nav, missing route, etc.) the step is
 *     skipped silently — the user is never stuck on a phantom anchor.
 *   - Backdrop dims the rest of the UI; the anchor is "cut out" via a
 *     pulsing outline. Tooltip pops to the right of the anchor with
 *     edge-detection so it doesn't fall off screen.
 *   - Keyboard: Esc dismisses, Enter advances.
 *
 * The component is pure presentation — no global state, no router
 * coupling. Mount it once in the app shell (Layout.tsx) and it self-
 * gates on the localStorage flag.
 */

import { useEffect, useState } from "react";
import { ArrowRight, Sparkles, X } from "lucide-react";

const DISMISS_KEY = "af2-onboarding-tour-dismissed-v1";

interface TourStep {
  /** CSS selector to anchor the tooltip onto. */
  selector: string;
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    selector: 'nav a[href="/hire"]',
    title: "Start here: write your mission",
    body: "Tell AutoFlow what you need done in plain English. We'll draft an org chart, budget, and first week of work in seconds.",
  },
  {
    selector: 'nav a[href="/mission-assignments"]',
    title: "Hand off work to an agent",
    body: "Every task an agent is supposed to pick up lives here. Create one any time from the New assignment button.",
  },
  {
    selector: 'nav a[href="/integrations/mcp"]',
    title: "Connect the tools your agents need",
    body: "Slack, Gmail, HubSpot, Stripe — connect once and every agent in the workspace can use them. OAuth or API key, your choice.",
  },
  {
    selector: 'nav a[href="/settings/llm-providers"]',
    title: "Add your model key",
    body: "Bring your own OpenAI / Anthropic / Mistral / etc. key. Your spend, your control. You can swap it any time.",
  },
];

export function OnboardingTour() {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  // First-mount gate. Defer to a short timeout so the sidebar is in
  // the DOM by the time we measure.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      // Storage disabled (private mode etc.) — treat as undismissed
      // for the session; the user can still Skip.
    }
    if (dismissed) return;
    const handle = window.setTimeout(() => setActive(true), 400);
    return () => window.clearTimeout(handle);
  }, []);

  // Re-measure on step change, scroll, or resize.
  useEffect(() => {
    if (!active) return;
    function update() {
      const step = STEPS[stepIndex];
      if (!step) return;
      const el = document.querySelector(step.selector) as HTMLElement | null;
      if (!el) {
        setAnchorRect(null);
        return;
      }
      setAnchorRect(el.getBoundingClientRect());
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const interval = window.setInterval(update, 500);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.clearInterval(interval);
    };
  }, [active, stepIndex]);

  // Keyboard: Esc dismisses, Enter advances.
  useEffect(() => {
    if (!active) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      } else if (event.key === "Enter") {
        event.preventDefault();
        next();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex]);

  function persistDismiss() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Quota / private-mode failures don't matter — flag stays for
      // the session anyway via React state.
    }
  }

  function dismiss() {
    setActive(false);
    persistDismiss();
  }

  function next() {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      dismiss();
    }
  }

  if (!active) return null;

  const step = STEPS[stepIndex];
  if (!step) return null;

  const isLast = stepIndex === STEPS.length - 1;
  const tooltipPosition = computeTooltipPosition(anchorRect);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-tour-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        pointerEvents: "none",
      }}
    >
      {/* Backdrop — dims everything except the anchor outline. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(20, 22, 28, 0.45)",
          transition: "background 200ms ease-out",
          pointerEvents: "auto",
        }}
        onClick={dismiss}
        aria-hidden="true"
      />

      {/* Anchor highlight — a pulsing outline around the target nav
          item. Falls back gracefully if the anchor is offscreen. */}
      {anchorRect ? (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: anchorRect.top - 6,
            left: anchorRect.left - 6,
            width: anchorRect.width + 12,
            height: anchorRect.height + 12,
            borderRadius: 10,
            boxShadow:
              "0 0 0 2px var(--af2-clay, #c0544c), 0 0 0 6px rgba(192,84,76,0.25), 0 0 40px rgba(192,84,76,0.25)",
            background: "transparent",
            animation: "af2-tour-pulse 1.6s ease-in-out infinite",
            pointerEvents: "none",
          }}
        />
      ) : null}

      {/* Tooltip card */}
      <div
        style={{
          position: "absolute",
          top: tooltipPosition.top,
          left: tooltipPosition.left,
          width: 320,
          background: "var(--af2-card, #fff)",
          borderRadius: 12,
          padding: 18,
          boxShadow:
            "0 20px 50px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.10)",
          pointerEvents: "auto",
          border: "1px solid var(--af2-line)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <div
            className="af2-eyebrow"
            style={{ color: "var(--af2-clay)", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Sparkles size={12} />
            Welcome · Step {stepIndex + 1} of {STEPS.length}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Skip tour"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--af2-muted)",
              padding: 2,
              cursor: "pointer",
            }}
          >
            <X size={14} />
          </button>
        </div>
        <h3
          id="onboarding-tour-title"
          className="font-af2-serif"
          style={{ margin: 0, fontSize: 16, color: "var(--af2-ink)" }}
        >
          {step.title}
        </h3>
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 13,
            color: "var(--af2-ink-2)",
            lineHeight: 1.5,
          }}
        >
          {step.body}
        </p>
        <div
          style={{
            marginTop: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={dismiss}
            className="af2-btn af2-btn-sm af2-btn-ghost"
          >
            Skip tour
          </button>
          <button
            type="button"
            onClick={next}
            className="af2-btn af2-btn-sm af2-btn-clay"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {isLast ? "Got it" : "Next"}
            <ArrowRight size={12} />
          </button>
        </div>
      </div>

      <TourKeyframes />
    </div>
  );
}

function computeTooltipPosition(rect: DOMRect | null): {
  top: number;
  left: number;
} {
  if (!rect || typeof window === "undefined") {
    return { top: 80, left: 80 };
  }
  // Anchor lives in the sidebar (left edge). Tooltip floats to the right
  // of the anchor; if that overflows the viewport, fall back to centered.
  const TOOLTIP_W = 320;
  const GAP = 16;
  let left = rect.right + GAP;
  if (left + TOOLTIP_W + 16 > window.innerWidth) {
    left = Math.max(16, window.innerWidth - TOOLTIP_W - 16);
  }
  // Vertically center the tooltip on the anchor's midline, but keep it
  // on screen. Tooltip is ~200px tall so clamp accordingly.
  const TOOLTIP_H_ESTIMATE = 200;
  let top = rect.top + rect.height / 2 - TOOLTIP_H_ESTIMATE / 2;
  top = Math.max(16, Math.min(window.innerHeight - TOOLTIP_H_ESTIMATE - 16, top));
  return { top, left };
}

const TOUR_KEYFRAME_ID = "af2-tour-keyframes";
function TourKeyframes() {
  if (typeof document !== "undefined" && !document.getElementById(TOUR_KEYFRAME_ID)) {
    const style = document.createElement("style");
    style.id = TOUR_KEYFRAME_ID;
    style.textContent = `
      @keyframes af2-tour-pulse {
        0%, 100% { box-shadow: 0 0 0 2px var(--af2-clay, #c0544c), 0 0 0 6px rgba(192,84,76,0.25), 0 0 40px rgba(192,84,76,0.20); }
        50%      { box-shadow: 0 0 0 2px var(--af2-clay, #c0544c), 0 0 0 8px rgba(192,84,76,0.35), 0 0 60px rgba(192,84,76,0.30); }
      }
    `;
    document.head.appendChild(style);
  }
  return null;
}
