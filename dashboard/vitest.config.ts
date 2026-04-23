import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": '"test"',
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    exclude: ["node_modules/**", "e2e/**"],
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: ["--max-old-space-size=4096"],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.tsx",
        "src/test-setup.ts",
        "src/**/*.test.{ts,tsx}",
        "src/pages/WorkflowBuilder.tsx",
        "src/pages/Memory.tsx",
        "src/data/mockData.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
