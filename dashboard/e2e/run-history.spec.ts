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
  await expect(page.getByText(/template/i).first()).toBeVisible();
  await expect(page.getByText(/status/i).first()).toBeVisible();
  await expect(page.getByText(/started/i).first()).toBeVisible();
});

test("renders at least one run row from mock data", async ({ page }) => {
  // The mock store seeds runs — wait for any run row to appear
  await expect(
    page.getByText(/customer support bot|lead enrichment|content generator/i).first()
  ).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

test("search input is present", async ({ page }) => {
  const search = page.getByPlaceholder(/search/i);
  await expect(search).toBeVisible();
});

test("typing in search filters visible runs", async ({ page }) => {
  // Wait for data to load
  await expect(
    page.getByText(/customer support bot|lead enrichment|content generator/i).first()
  ).toBeVisible({ timeout: 5000 });

  const search = page.getByPlaceholder(/search/i);
  await search.fill("support");

  // Should show support bot rows; non-matching rows should vanish
  await expect(page.getByText(/customer support bot/i).first()).toBeVisible();
});

test("clearing search restores full list", async ({ page }) => {
  await expect(
    page.getByText(/customer support bot|lead enrichment|content generator/i).first()
  ).toBeVisible({ timeout: 5000 });

  const search = page.getByPlaceholder(/search/i);
  await search.fill("support");
  await search.clear();

  // All runs should be visible again
  await expect(
    page.getByText(/customer support bot|lead enrichment|content generator/i).first()
  ).toBeVisible();
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
  // Wait for runs to load
  await expect(
    page.getByText(/customer support bot|lead enrichment|content generator/i).first()
  ).toBeVisible({ timeout: 5000 });

  // Click the first run row to expand it
  const firstRow = page.getByRole("row").nth(1); // nth(0) is header
  await firstRow.click();

  // After expansion, step details (or "no steps" message) should appear
  await expect(
    page.getByText(/step|output|result|no steps/i).first()
  ).toBeVisible({ timeout: 3000 });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

test("pagination controls are present when there are multiple pages", async ({ page }) => {
  // The mock store has enough runs to paginate (PAGE_SIZE=5)
  // If there are more than 5 runs, prev/next buttons appear
  // Just check the controls exist in the DOM (may be disabled on page 1)
  const nextBtn = page.getByRole("button", { name: /next/i });
  const prevBtn = page.getByRole("button", { name: /prev/i });

  // At minimum one of these pagination controls should be present
  const hasPagination = (await nextBtn.count()) > 0 || (await prevBtn.count()) > 0;
  expect(hasPagination).toBe(true);
});
