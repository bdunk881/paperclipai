/**
 * E2E: Workflow Builder critical path — "create workflow" and "trigger run"
 *
 * Tests:
 *  1. /builder renders the template selector
 *  2. Selecting a template shows its steps
 *  3. Expanding a step shows its details
 *  4. Run button is present after template loads
 *  5. Clicking Run navigates to the monitor
 *
 * All API calls are served by VITE_USE_MOCK=true.
 */

import { test, expect } from "@playwright/test";
import { loginAsMockUser } from "./helpers/auth";

test.beforeEach(async ({ page }) => {
  await loginAsMockUser(page);
});

// ---------------------------------------------------------------------------
// Template selector
// ---------------------------------------------------------------------------

test("builder page renders the template list", async ({ page }) => {
  await page.goto("/builder");
  // Three templates should be listed
  await expect(page.getByText(/customer support bot/i)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/lead enrichment/i)).toBeVisible();
  await expect(page.getByText(/content generator/i)).toBeVisible();
});

test("selecting a template via URL loads its steps", async ({ page }) => {
  await page.goto("/builder/tpl-support-bot");
  await expect(page.getByRole("textbox").first()).toHaveValue(/customer support bot/i, { timeout: 5000 });
  // Steps section should appear — Trigger is first step kind
  await expect(page.getByText(/trigger/i).first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// Step interaction
// ---------------------------------------------------------------------------

test("each step card is visible and shows its kind label", async ({ page }) => {
  await page.goto("/builder/tpl-support-bot");
  // The support bot has an LLM step
  await expect(page.getByText(/llm/i).first()).toBeVisible({ timeout: 5000 });
});

test("clicking a step expands to show description", async ({ page }) => {
  await page.goto("/builder/tpl-support-bot");
  // Fall back: just click the first step-kind label area
  const firstStep = page.getByText(/trigger/i).first();
  await firstStep.click();
  await expect(page.getByRole("textbox").first()).toHaveValue(/customer support bot/i, { timeout: 5000 });
  await expect(page.locator("textarea").first()).toHaveValue(/capture the incoming support request/i);
});

// ---------------------------------------------------------------------------
// Run workflow
// ---------------------------------------------------------------------------

test("Run button is present after template loads", async ({ page }) => {
  await page.goto("/builder/tpl-support-bot");
  const runBtn = page.getByRole("button", { name: /^run$/i });
  await expect(runBtn).toBeVisible({ timeout: 5000 });
});

test("clicking Run navigates to the monitor", async ({ page }) => {
  await page.goto("/builder/tpl-support-bot");

  const runBtn = page.getByRole("button", { name: /^run$/i });
  await expect(runBtn).toBeVisible({ timeout: 5000 });
  await runBtn.click();

  await expect(page).toHaveURL(/\/monitor/, { timeout: 5000 });
  await expect(page.getByRole("heading", { name: /run monitor/i })).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Template switching
// ---------------------------------------------------------------------------

test("switching templates in selector loads new template steps", async ({ page }) => {
  await page.goto("/builder");

  // Click on Lead Enrichment template
  const leadCard = page.getByText(/lead enrichment/i).first();
  await expect(leadCard).toBeVisible({ timeout: 5000 });
  await leadCard.click();

  // URL should update to the lead enrichment template
  await expect(page).toHaveURL(/\/builder\/tpl-lead-enrich/, { timeout: 5000 });
  await expect(page.getByRole("textbox").first()).toHaveValue(/lead enrichment/i, { timeout: 5000 });
});
