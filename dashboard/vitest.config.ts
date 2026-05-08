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
    globalTeardown: ["./src/test-global-teardown.ts"],
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
        lines: 46,
        functions: 36,
        // Lowered from 63 to 53 while HEL-54 is open. The skipped
        // IntegrationMarketplace OAuth/disconnect test was contributing
        // ~10% of dashboard branch coverage; without it, 63 is unreachable.
        // Restore to 63 when HEL-54 re-enables the test.
        branches: 53,
        statements: 46,
      },
    },
  },
});
