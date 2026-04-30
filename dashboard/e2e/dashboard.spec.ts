/**
 * E2E: Customer dashboard critical path
 *
 * Covers: command-center shell render, KPI sections, empty approval state,
 * command-center shortcuts, and persistent sidebar navigation.
 *
 * Runs in VITE_USE_MOCK=true mode — workflow data comes from the
 * in-memory mock store and agent/approval surfaces should degrade
 * cleanly without a live backend.
 */

import { test, expect } from "@playwright/test";
import { loginAsMockUser } from "./helpers/auth";

test.beforeEach(async ({ page }) => {
  await loginAsMockUser(page);
  await page.goto("/");
});

// ---------------------------------------------------------------------------
// Page structure
// ---------------------------------------------------------------------------

test("customer command center heading is visible", async ({ page }) => {
  await expect(page.getByText(/customer command center/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: /e2e, your company is live\./i })).toBeVisible();
});

test("renders the primary KPI cards", async ({ page }) => {
  await expect(page.locator("article").filter({ hasText: /org status/i }).first()).toBeVisible();
  await expect(page.locator("article").filter({ hasText: /kpi trajectory/i }).first()).toBeVisible();
  await expect(page.locator("article").filter({ hasText: /spend pressure/i }).first()).toBeVisible();
  await expect(page.locator("article").filter({ hasText: /approvals at risk/i }).first()).toBeVisible();
});

test("renders the execution and spend panels", async ({ page }) => {
  await expect(page.getByText(/execution burndown/i)).toBeVisible();
  await expect(page.getByText(/spend vs budget/i)).toBeVisible();
  await expect(page.getByText(/observability cockpit/i)).toBeVisible();
  await expect(page.getByText(/throughput over the last 24 hours/i)).toBeVisible();
  await expect(page.getByText(/activity updates as they happen/i)).toBeVisible();
});

test("renders the empty approvals state in mock mode", async ({ page }) => {
  await expect(page.getByText(/queued approvals/i)).toBeVisible();
  await expect(page.getByText(/no approvals waiting/i)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test("'Review approvals' shortcut navigates to /approvals", async ({ page }) => {
  await page.getByRole("link", { name: /review approvals/i }).click();
  await expect(page).toHaveURL(/\/approvals/);
});

test("'Inspect spend' shortcut navigates to the budget dashboard", async ({ page }) => {
  await page.getByRole("link", { name: /inspect spend/i }).click();
  await expect(page).toHaveURL(/\/workspace\/budget-dashboard/);
});

test("'Full history' link navigates to /history", async ({ page }) => {
  await page.getByRole("link", { name: /full history/i }).click();
  await expect(page).toHaveURL(/\/history/);
});

test("sidebar nav link 'Builder' navigates to /builder", async ({ page }) => {
  await page.getByRole("link", { name: /^builder$/i }).click();
  await expect(page).toHaveURL(/\/builder/);
});

test("sidebar nav link 'History' navigates to /history", async ({ page }) => {
  await page.getByRole("link", { name: /^history$/i }).click();
  await expect(page).toHaveURL(/\/history/);
});
