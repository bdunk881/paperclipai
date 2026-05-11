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
        // --- complex UI pages excluded like WorkflowBuilder / Memory ---
        "src/pages/WorkflowBuilder.tsx",
        "src/pages/Memory.tsx",
        // Heavy UI components with no meaningful unit-testable logic
        "src/pages/AgentTeamDetail.tsx",
        "src/pages/AgentDeploy.tsx",       // deployment wizard, pure UI flow
        "src/pages/OrgStructure.tsx",      // org chart visualisation (rendering only)
        "src/pages/BudgetDashboard.tsx",   // pending restyle in HEL-61
        "src/pages/TicketActorView.tsx",   // ticket actor view, pure UI
        "src/pages/TicketTeamView.tsx",    // ticket team view, pure UI
        // One-off config / init files
        "src/data/mockData.ts",
        "src/sentry.ts",                   // Sentry initialisation, side-effect only
        "src/test-global-teardown.ts",     // test infrastructure
      ],
      thresholds: {
        lines: 46,
        functions: 36,
        branches: 63,
        statements: 46,
      },
    },
  },
});
