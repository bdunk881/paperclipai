/**
 * E2E: Beta onboarding happy path
 *
 * Covers the full flow: welcome → template picker → configurator → first run →
 * success screen. Runs in VITE_USE_MOCK=true mode.
 *
 * Auth is bypassed by seeding localStorage with autoflow_user and
 * a pre-completed onboarding entry is cleared so the wizard always starts fresh.
 */

import { test, expect } from "@playwright/test";
import { loginAsMockUser } from "./helpers/auth";

/** Seed auth + clear any prior onboarding state so the wizard starts at welcome. */
async function setupOnboarding(page: Parameters<typeof loginAsMockUser>[0]) {
  await loginAsMockUser(page);
  await page.addInitScript(() => {
    localStorage.removeItem("autoflow_onboarding");
  });
}

// ---------------------------------------------------------------------------
// Welcome screen
// ---------------------------------------------------------------------------

test("onboarding welcome screen renders get-started CTA", async ({ page }) => {
  await setupOnboarding(page);
  await page.goto("/onboarding");

  await expect(page.getByRole("heading", { name: /welcome to autoflow/i })).toBeVisible();
  await expect(page.getByTestId("onboarding-get-started")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Template picker
// ---------------------------------------------------------------------------

test("template picker shows all 6 templates", async ({ page }) => {
  await setupOnboarding(page);
  await page.goto("/onboarding/templates");

  // Wait for async mock data to load
  await expect(page.getByTestId("template-card-tpl-support-bot")).toBeVisible({ timeout: 5000 });

  const cards = page.locator("[data-testid^='template-card-']");
  await expect(cards).toHaveCount(6);
});

test("continue button is disabled until a template is selected", async ({ page }) => {
  await setupOnboarding(page);
  await page.goto("/onboarding/templates");

  await expect(page.getByTestId("template-picker-continue")).toBeDisabled();

  await page.getByTestId("template-card-tpl-support-bot").click();
  await expect(page.getByTestId("template-picker-continue")).toBeEnabled();
});

// ---------------------------------------------------------------------------
// Full happy path
// ---------------------------------------------------------------------------

test("full onboarding happy path: welcome → template → configure → success", async ({ page }) => {
  await setupOnboarding(page);

  // Step 1 — Welcome
  await page.goto("/onboarding");
  await expect(page.getByTestId("onboarding-get-started")).toBeVisible();
  await page.getByTestId("onboarding-get-started").click();

  // Step 2 — Template picker
  await expect(page).toHaveURL("/onboarding/templates");
  // Wait for templates to load
  await expect(page.getByTestId("template-card-tpl-lead-enrich")).toBeVisible({ timeout: 5000 });

  // Select Lead Enrichment (has required config fields — good test coverage)
  await page.getByTestId("template-card-tpl-lead-enrich").click();
  await page.getByTestId("template-picker-continue").click();

  // Step 3 — Configurator
  await expect(page).toHaveURL(/\/onboarding\/configure\/tpl-lead-enrich/);
  await expect(page.getByRole("heading", { name: /lead enrichment/i })).toBeVisible();

  // Fill required fields
  const scoreField = page.locator('input[type="number"]').first();
  await scoreField.fill("75");

  const crmSelect = page.locator("select").first();
  await crmSelect.selectOption("salesforce");

  // Step 4 — Launch run
  await page.getByTestId("run-workflow-btn").click();

  // Loading state visible during mock delay
  await expect(page.getByTestId("run-workflow-btn")).toContainText(/launching/i, { timeout: 2000 });

  // Step 5 — Success screen
  await expect(page).toHaveURL("/onboarding/success", { timeout: 5000 });
  await expect(page.getByRole("heading", { name: /your workflow is running/i })).toBeVisible();
  await expect(page.getByTestId("view-run-monitor-btn")).toBeVisible();
  await expect(page.getByTestId("invite-teammate-btn")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Success screen navigation
// ---------------------------------------------------------------------------

test("'View Run Monitor' on success screen navigates to /monitor", async ({ page }) => {
  await setupOnboarding(page);
  // Seed a completed onboarding state at success step
  await page.addInitScript(() => {
    localStorage.setItem(
      "autoflow_onboarding",
      JSON.stringify({
        completed: false,
        step: "success",
        selectedTemplateId: "tpl-support-bot",
        lastRunId: "run-e2e-1",
      })
    );
  });

  await page.goto("/onboarding/success");
  await page.getByTestId("view-run-monitor-btn").click();

  await expect(page).toHaveURL("/monitor");
});

test("'Skip to dashboard' on success screen completes onboarding and navigates to /", async ({
  page,
}) => {
  await setupOnboarding(page);
  await page.addInitScript(() => {
    // Seed completed onboarding state so AppRoute allows / access
    localStorage.setItem(
      "autoflow_onboarding",
      JSON.stringify({
        completed: false,
        step: "success",
        selectedTemplateId: "tpl-support-bot",
        lastRunId: "run-e2e-2",
      })
    );
  });

  await page.goto("/onboarding/success");
  await page.getByTestId("go-to-dashboard-btn").click();

  await expect(page).toHaveURL("/");
});

// ---------------------------------------------------------------------------
// Invite teammate
// ---------------------------------------------------------------------------

test("invite teammate form sends invite and shows confirmation", async ({ page }) => {
  await setupOnboarding(page);
  await page.goto("/onboarding/invite");

  await page.getByTestId("invite-email-input").fill("teammate@example.com");
  await page.getByTestId("send-invite-btn").click();

  await expect(page.getByText(/invite sent/i)).toBeVisible();
  await expect(page.getByTestId("invite-finish-btn")).toBeVisible();
});

test("invite teammate shows error for invalid email", async ({ page }) => {
  await setupOnboarding(page);
  await page.goto("/onboarding/invite");

  await page.getByTestId("invite-email-input").fill("not-an-email");
  await page.getByTestId("send-invite-btn").click();

  await expect(page.getByText(/valid email/i)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Onboarding persistence
// ---------------------------------------------------------------------------

test("onboarding state is restored from localStorage on reload", async ({ page }) => {
  await setupOnboarding(page);

  // Seed a mid-flow state (templates step)
  await page.addInitScript(() => {
    localStorage.setItem(
      "autoflow_onboarding",
      JSON.stringify({ completed: false, step: "templates" })
    );
  });

  // Navigating to /onboarding/templates should work without redirect
  await page.goto("/onboarding/templates");
  await expect(page.getByRole("heading", { name: /pick a workflow template/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Redirect gate
// ---------------------------------------------------------------------------

test("authenticated user with completed onboarding can access /", async ({ page }) => {
  await loginAsMockUser(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "autoflow_onboarding",
      JSON.stringify({ completed: true, step: "success" })
    );
  });

  await page.goto("/");
  await expect(page).toHaveURL("/");
});
