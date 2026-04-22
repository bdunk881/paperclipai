/**
 * E2E: Run History page — "view logs" critical path
 *
 * Tests:
 *  1. Run History page renders the table
 *  2. Search filters runs by template name
 *  3. Status filter works
 *  4. Expanding a run shows its step results
 *  5. Pagination controls appear when there are enough runs
 *
 * All API calls served by VITE_USE_MOCK=true.
 */

import { test, expect } from "@playwright/test";
import { loginAsMockUser } from "./helpers/auth";

test.beforeEach(async ({ page }) => {
  await loginAsMockUser(page);
  await page.goto("/history");
});

// ---------------------------------------------------------------------------
// Page structure
// ---------------------------------------------------------------------------

test("run history page renders the table heading", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /run history/i })).toBeVisible();
});

test("renders table column headers: Template, Status, Started", async ({ page }) => {
  await expect(page.getByText(/workflow/i).first()).toBeVisible();
  await expect(page.getByText(/status/i).first()).toBeVisible();
  await expect(page.getByText(/started/i).first()).toBeVisible();
});

test("renders at least one run row from mock data", async ({ page }) => {
  await expect(page.getByRole("row").nth(1)).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

test("search input is present", async ({ page }) => {
  const search = page.getByPlaceholder(/run id or workflow name/i);
  await expect(search).toBeVisible();
});

test("typing in search filters visible runs", async ({ page }) => {
  await expect(page.getByRole("row").nth(1)).toBeVisible({ timeout: 5000 });

  const search = page.getByPlaceholder(/run id or workflow name/i);
  await search.fill("support");

  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.locator("tbody tr").first().getByText(/customer support bot/i)).toBeVisible();
});

test("clearing search restores full list", async ({ page }) => {
  await expect(page.getByRole("row").nth(1)).toBeVisible({ timeout: 5000 });

  const search = page.getByPlaceholder(/run id or workflow name/i);
  await search.fill("support");
  await search.clear();

  await expect(page.getByRole("row").nth(1)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Status filter
// ---------------------------------------------------------------------------

test("status filter dropdown is present", async ({ page }) => {
  // There should be a select or combobox for status
  const statusFilter = page.getByRole("combobox").first();
  await expect(statusFilter).toBeVisible();
});

// ---------------------------------------------------------------------------
// Row expansion (view logs)
// ---------------------------------------------------------------------------

test("clicking a run row expands to show step results", async ({ page }) => {
  await expect(page.getByRole("row").nth(1)).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: /open run audit for/i }).first().click();
  await expect(page.getByText(/run audit/i).first()).toBeVisible({ timeout: 3000 });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

test("pagination controls are present when there are multiple pages", async ({ page }) => {
  await expect(page.getByText(/page 1 of 2/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "2" })).toBeVisible();
});
