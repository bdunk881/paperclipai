/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1", // Indigo Primary
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
          950: "#1e1b4b",
        },
        accent: {
          teal: "#14b8a6",
          orange: "#f97316",
        },
        surface: {
          0: "#ffffff",
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569",
          700: "#334155",
          800: "#1e293b",
          850: "#172033",
          900: "#0f172a",
          950: "#020617",
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
      },
      fontSize: {
        "display-xl": ["4.5rem", { lineHeight: "1.05", letterSpacing: "-0.03em", fontWeight: "800" }],
        "display": ["3.5rem", { lineHeight: "1.1", letterSpacing: "-0.025em", fontWeight: "800" }],
        "display-sm": ["2.5rem", { lineHeight: "1.15", letterSpacing: "-0.02em", fontWeight: "700" }],
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "hero-mesh": "radial-gradient(ellipse 80% 60% at 50% -20%, rgba(124,58,237,0.25), transparent), radial-gradient(ellipse 60% 50% at 80% 50%, rgba(6,182,212,0.15), transparent)",
        "hero-mesh-dark": "radial-gradient(ellipse 80% 60% at 50% -20%, rgba(124,58,237,0.35), transparent), radial-gradient(ellipse 60% 50% at 80% 50%, rgba(6,182,212,0.2), transparent)",
        "glow-purple": "radial-gradient(ellipse at center, rgba(124,58,237,0.15) 0%, transparent 70%)",
        "glow-cyan": "radial-gradient(ellipse at center, rgba(6,182,212,0.12) 0%, transparent 70%)",
      },
      boxShadow: {
        glow: "0 0 20px rgba(99,102,241,0.15), 0 0 60px rgba(99,102,241,0.05)",
        "glow-lg": "0 0 40px rgba(99,102,241,0.2), 0 0 80px rgba(99,102,241,0.08)",
        "card": "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)",
        "card-hover": "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)",
        "card-dark": "0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.03)",
        "card-dark-hover": "0 8px 24px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)",
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
