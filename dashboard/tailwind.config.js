/** @type {import('tailwindcss').Config} */
export default {
  // HEL-116b — dark mode dropped; v2 paper aesthetic is light-only.
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // AutoFlow v2 canonical token set — referenced via CSS custom
        // properties in dashboard/src/af2-tokens.css. v1 brand/surface/
        // accent palettes were removed in HEL-116 (all v1 palette refs
        // are zero across the dashboard).
        af2: {
          paper: "var(--af2-paper)",
          "paper-2": "var(--af2-paper-2)",
          "paper-3": "var(--af2-paper-3)",
          card: "var(--af2-card)",
          ink: "var(--af2-ink)",
          "ink-2": "var(--af2-ink-2)",
          "ink-3": "var(--af2-ink-3)",
          "ink-4": "var(--af2-ink-4)",
          line: "var(--af2-line)",
          "line-2": "var(--af2-line-2)",
          clay: "var(--af2-clay)",
          "clay-2": "var(--af2-clay-2)",
          "clay-soft": "var(--af2-clay-soft)",
          sage: "var(--af2-sage)",
          "sage-2": "var(--af2-sage-2)",
          mustard: "var(--af2-mustard)",
          "mustard-2": "var(--af2-mustard-2)",
          plum: "var(--af2-plum)",
          "ink-blue": "var(--af2-ink-blue)",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        // AutoFlow v2 type stacks (HEL-30) — Fraunces serif display +
        // Geist UI sans + JetBrains Mono. Use via font-af2-serif,
        // font-af2-sans, font-af2-mono on pages migrated to v2.
        "af2-serif": [
          "Fraunces",
          "Source Serif 4",
          "Iowan Old Style",
          "Georgia",
          "serif",
        ],
        "af2-sans": [
          "Geist",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        "af2-mono": [
          "JetBrains Mono",
          "SFMono-Regular",
          "ui-monospace",
          "Menlo",
          "monospace",
        ],
      },
      fontSize: {
        "display-xl": ["4.5rem", { lineHeight: "1.05", letterSpacing: "-0.03em", fontWeight: "800" }],
        "display": ["3.5rem", { lineHeight: "1.1", letterSpacing: "-0.025em", fontWeight: "800" }],
        "display-sm": ["2.5rem", { lineHeight: "1.15", letterSpacing: "-0.02em", fontWeight: "700" }],
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
      },
      boxShadow: {
        // HEL-116 — paper-feeling shadows; v1 indigo glow + dark card shadows
        // deleted. shadow-glow / shadow-glow-lg are kept (decorative effect
        // used by TicketDetail; retuned to af2-clay).
        glow: "0 0 20px color-mix(in srgb, var(--af2-clay) 18%, transparent), 0 0 60px color-mix(in srgb, var(--af2-clay) 6%, transparent)",
        "glow-lg": "0 0 40px color-mix(in srgb, var(--af2-clay) 22%, transparent), 0 0 80px color-mix(in srgb, var(--af2-clay) 8%, transparent)",
        af2: "0 1px 0 rgba(26,20,16,0.04), 0 6px 20px rgba(26,20,16,0.06)",
        "af2-lg": "0 1px 0 rgba(26,20,16,0.04), 0 18px 40px rgba(26,20,16,0.10)",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      animation: {
        "gradient-x": "gradient-x 8s ease infinite",
        "fade-in": "fade-in 0.5s ease-out",
        "slide-up": "slide-up 0.5s ease-out",
        "glow-pulse": "glow-pulse 3s ease-in-out infinite",
      },
      keyframes: {
        "gradient-x": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "glow-pulse": {
          "0%, 100%": { opacity: "0.5" },
          "50%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
