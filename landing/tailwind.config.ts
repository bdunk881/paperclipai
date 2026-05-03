import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          indigo: "#6366f1",
          teal: "#14b8a6",
          orange: "#f97316",
        },
        surface: {
          base: "#0f172a",
          deep: "#020617",
          elevated: "#1e293b",
        },
        slate: {
          100: "#f1f5f9",
          400: "#94a3b8",
          500: "#64748b",
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
          950: "#020617",
        }
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Poppins", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      backgroundImage: {
        "hero-gradient":
          "linear-gradient(135deg, #6366f1 0%, #14b8a6 50%, #f97316 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
