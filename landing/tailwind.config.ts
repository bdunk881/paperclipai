import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // v2 "Workplace" palette — see app/v2.css for the canonical tokens.
        af2: {
          paper: "#f6f1e7",
          "paper-2": "#ede5d3",
          "paper-3": "#e3d9c2",
          card: "#ffffff",
          ink: "#1a1410",
          "ink-2": "#3a2f25",
          "ink-3": "#6b5a48",
          "ink-4": "#94836e",
          clay: "#c2502b",
          "clay-2": "#d96239",
          "clay-soft": "#f0c8b8",
          sage: "#4a6b4a",
          "sage-2": "#6b8e6b",
          mustard: "#b8862c",
          "mustard-2": "#d49e3e",
          plum: "#5d3a5e",
          "ink-blue": "#1f3a52",
        },
      },
      fontFamily: {
        // v2 typography: Fraunces (serif display) + Geist (UI) + JetBrains Mono.
        sans: ["Geist", "Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        serif: ["Fraunces", "Source Serif 4", "Iowan Old Style", "Georgia", "serif"],
        mono: ["JetBrains Mono", "SFMono-Regular", "ui-monospace", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
