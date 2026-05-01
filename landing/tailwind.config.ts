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
          teal: 'var(--color-primary)',
          indigo: 'var(--color-accent)',
          orange: 'var(--color-trigger)',
        },
        obsidian: {
          dark: 'var(--color-bg)',
          slate: 'var(--color-bg-subtle)',
        }
      },
      fontFamily: {
        sans: ["var(--font-heading)", "Inter", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
