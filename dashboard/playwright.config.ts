import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration for AutoFlow dashboard.
 *
 * Runs against the Vite dev server (VITE_USE_MOCK=true) so no backend
 * is required during CI. The mock API client returns deterministic data
 * that the tests can assert against.
 */

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "VITE_USE_MOCK=true npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
