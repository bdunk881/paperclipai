/**
 * ProReveal — HEL-214 / PR J.
 *
 * Shared wrapper for Pro-mode actionable reveals on each major surface.
 * Renders children only when the user's ExperienceMode is `"pro"`. Provides
 * the visual chrome (dashed border, "PRO" eyebrow, label) that every Pro
 * surface uses so the diff at each call-site stays tiny.
 *
 * Usage:
 *   <ProReveal label="Rule debugger">
 *     <RuleDebugger />
 *   </ProReveal>
 *
 * The wrapper consults `useExperienceMode()` and short-circuits to `null`
 * for guided / simple users — keeping the surface DOM identical for the
 * default audience and avoiding accidental layout shifts.
 */
import type { ReactNode } from "react";
import { useExperienceMode } from "../../context/ExperienceModeContext";

interface ProRevealProps {
  /** Short, human-readable label rendered next to the PRO eyebrow. */
  label: string;
  /** Optional sub-copy explaining what the reveal exposes. */
  description?: string;
  children: ReactNode;
}

export function ProReveal({ label, description, children }: ProRevealProps) {
  const { mode } = useExperienceMode();
  if (mode !== "pro") return null;

  return (
    <section
      data-pro-reveal={label}
      style={{
        marginTop: 32,
        padding: 20,
        borderRadius: 14,
        border: "1.5px dashed var(--af2-line, #d6d3cc)",
        background: "var(--af2-paper-2, rgba(247,243,233,0.55))",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "2px 8px",
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--af2-clay-2, #a85936)",
            background: "var(--af2-clay-soft, rgba(189,99,63,0.12))",
            border: "1px solid var(--af2-clay, #bd633f)",
          }}
        >
          PRO
        </span>
        <h3
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--af2-ink, #2b2a25)",
          }}
        >
          {label}
        </h3>
        {description ? (
          <span
            style={{
              fontSize: 12,
              color: "var(--af2-ink-3, #6b6a64)",
              flex: "1 1 auto",
            }}
          >
            {description}
          </span>
        ) : null}
      </header>
      <div>{children}</div>
    </section>
  );
}

export default ProReveal;
