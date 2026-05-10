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
        // Branches still at 53 — this PR (HEL-57) added direct unit tests for
        // handleConnectAction which contributed ~1pp of branch coverage. To
        // reach 63 we need a broader sweep across other low-coverage files.
        // Tracked as HEL-73.
        branches: 53,
        statements: 46,
      },
    },
  },
});
