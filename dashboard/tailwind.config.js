/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          // Palette
          teal: "#00D4B8",
          indigo: "#4A3AFF",
          coral: "#FF5F57",
          yellow: "#FFD93D",
          navy: "#0F1333",
          slate: "#2D3748",
          cloud: "#F7FAFC",
          // Semantic aliases
          primary: "#4A3AFF",
          "primary-hover": "#3b2ce0",
          "primary-light": "#ede8ff",
          accent: "#00D4B8",
          cta: "#FF5F57",
          "cta-hover": "#e54e46",
        },
      },
      fontFamily: {
        display: ["Poppins", "ui-sans-serif", "system-ui"],
        sans: ["Inter", "ui-sans-serif", "system-ui"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
