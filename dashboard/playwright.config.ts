import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "**/auth.spec.ts",
    "**/auth-regression.spec.ts",
    // HEL-28: golden-path Playwright e2e. Phase tests blocked on other
    // P2 tickets are marked with `test.fixme()` and will start passing
    // automatically as their unblocking tickets land.
    "**/golden-path.spec.ts",
  ],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        // In CI, `Infisical/secrets-action@v1.0.9` has already exported the dev
        // secrets into process.env before Playwright starts. Re-wrapping with
        // `infisical run` would require either a `.infisical.json` project
        // binding or a `--projectId` flag — neither of which the action sets up.
        // Using the unwrapped script reads from process.env directly.
        //
        // Locally, `npm run dev` (wrapped) is the right default so devs don't
        // forget to load secrets.
        command: process.env.CI ? "npm run dev:no-secrets" : "npm run dev",
        url: "http://localhost:5173",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
