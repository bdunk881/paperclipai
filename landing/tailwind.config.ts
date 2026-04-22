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
          teal: "#00D4B8",
          indigo: "#4A3AFF",
          coral: "#FF5F57",
          yellow: "#FFD93D",
          navy: "#0F1333",
          slate: "#2D3748",
          cloud: "#F7FAFC",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
        display: ["Poppins", "ui-sans-serif", "system-ui"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      backgroundImage: {
        "hero-gradient":
          "linear-gradient(135deg, #4A3AFF 0%, #00D4B8 50%, #FFD93D 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
