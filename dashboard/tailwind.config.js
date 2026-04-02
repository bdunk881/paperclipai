/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
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
        display: ["Poppins", "ui-sans-serif", "system-ui"],
        sans: ["Inter", "ui-sans-serif", "system-ui"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
