/**
 * E2E: Dashboard critical path
 *
 * Covers: stats cards render, recent runs list, template cards,
 * navigation links to builder and history.
 *
 * Runs in VITE_USE_MOCK=true mode — all API data comes from the
 * in-memory mock store, so assertions use mock-data-aware values.
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

test("dashboard heading is visible", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /welcome back, e2e/i })).toBeVisible();
  await expect(page.getByText(/autoflow dashboard/i)).toBeVisible();
});

test("renders four stat cards: Total Runs, Running, Completed, Failed", async ({ page }) => {
  await expect(page.getByText(/total runs/i).first()).toBeVisible();
  await expect(page.getByText(/^running$/i).first()).toBeVisible();
  await expect(page.getByText(/^completed$/i).first()).toBeVisible();
  await expect(page.getByText(/^failed$/i).first()).toBeVisible();
});

test("renders Recent Runs section", async ({ page }) => {
  await expect(page.getByText(/recent runs/i)).toBeVisible();
});

test("renders Workflows section with at least one template card", async ({ page }) => {
  // Wait for mock data to load
  await expect(page.getByRole("heading", { name: /workflows/i })).toBeVisible();
  // There are 3 mock templates
  const templateLinks = page.getByRole("link", { name: /customer support bot|lead enrichment|content generator/i });
  await expect(templateLinks.first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test("'View all' runs link navigates to /history", async ({ page }) => {
  await page.getByRole("link", { name: /view all/i }).click();
  await expect(page).toHaveURL(/\/history/);
});

test("clicking a template card navigates to /builder/:templateId", async ({ page }) => {
  // Wait for templates to render
  const builderLink = page.getByRole("link", { name: /customer support bot/i }).first();
  await expect(builderLink).toBeVisible({ timeout: 5000 });
  await builderLink.click();
  await expect(page).toHaveURL(/\/builder\//);
});

test("sidebar nav link 'Builder' navigates to /builder", async ({ page }) => {
  await page.getByRole("link", { name: /^builder$/i }).click();
  await expect(page).toHaveURL(/\/builder/);
});

test("sidebar nav link 'History' navigates to /history", async ({ page }) => {
  await page.getByRole("link", { name: /^history$/i }).click();
  await expect(page).toHaveURL(/\/history/);
});
