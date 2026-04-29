/**
 * E2E: Observability dashboard critical path
 *
 * Covers: observability shell render, transport controls, KPI prototype,
 * live feed frame, and navigation links that remain on the dashboard surface.
 *
 * Runs in VITE_USE_MOCK=true mode.
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

test("observability cockpit heading is visible", async ({ page }) => {
  await expect(page.getByText(/observability cockpit/i)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /live activity, health, and throughput in one operator view\./i })
  ).toBeVisible();
});

test("renders transport controls and KPI prototype sections", async ({ page }) => {
  await expect(page.getByText(/transport status/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /all activity/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /alerts/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /24h/i })).toBeVisible();
  await expect(page.getByText("KPI prototype", { exact: true })).toBeVisible();
  await expect(page.getByText(/throughput over the last 24 hours/i)).toBeVisible();
  await expect(page.getByText(/^created$/i)).toBeVisible();
  await expect(page.getByText(/^completed$/i)).toBeVisible();
  await expect(page.getByText(/^blocked$/i)).toBeVisible();
});

test("renders live feed and continuity sections", async ({ page }) => {
  await expect(page.getByText(/activity updates as they happen/i)).toBeVisible();
  await expect(page.getByText("Transport continuity", { exact: true })).toBeVisible();
  await expect(page.getByText("Sprint 2 reserve", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /refresh data/i })).toBeVisible();
});

test("feed filter buttons toggle pressed state", async ({ page }) => {
  const allActivity = page.getByRole("button", { name: /all activity/i });
  const alerts = page.getByRole("button", { name: /alerts/i });

  await expect(allActivity).toHaveAttribute("aria-pressed", "true");
  await alerts.click();
  await expect(alerts).toHaveAttribute("aria-pressed", "true");
  await expect(allActivity).toHaveAttribute("aria-pressed", "false");
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

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
