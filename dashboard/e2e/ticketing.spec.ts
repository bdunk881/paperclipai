import { test, expect } from "@playwright/test";
import { loginAsMockUser } from "./helpers/auth";

test.beforeEach(async ({ page }) => {
  await loginAsMockUser(page);
});

test("creates a ticket from the queue and lands on the detail view", async ({ page }) => {
  await page.goto("/tickets");

  await expect(page.getByRole("heading", { name: /ticketing command surface/i })).toBeVisible();

  await page.getByRole("button", { name: /^create ticket$/i }).first().click();
  await expect(page.getByRole("heading", { name: /capture work with full operating context/i })).toBeVisible();

  await page.locator("form").getByRole("button", { name: /^create ticket$/i }).click();
  await expect(page.getByText(/title is required/i)).toBeVisible();

  await page.getByLabel(/ticket title/i).fill("QA ticket: verify create flow");
  await page.getByLabel(/ticket description/i).fill("Created by Playwright to validate the ticket queue path.");
  await page.getByLabel(/primary assignee/i).selectOption("agent:frontend-engineer");
  await page.getByLabel(/ticket tags/i).fill("qa,e2e");
  await page.getByLabel(/request external sync/i).check();

  await page.locator("form").getByRole("button", { name: /^create ticket$/i }).click();

  await expect(page).toHaveURL(/\/tickets\/ticket_/);
  await expect(page.getByRole("heading", { name: /qa ticket: verify create flow/i })).toBeVisible();
  await expect(page.getByText(/activity stream/i)).toBeVisible();
  await expect(page.getByRole("main").getByText(/^memory$/i)).toBeVisible();
});

test("navigates from team view to actor queue to ticket detail", async ({ page }) => {
  await page.goto("/tickets/team");

  await expect(page.getByRole("heading", { name: /team ticket view/i })).toBeVisible();
  await page.getByRole("link", { name: /frontend engineer/i }).first().click();

  await expect(page).toHaveURL(/\/tickets\/actors\/agent\/frontend-engineer/);
  await expect(page.getByText(/queue owner/i)).toBeVisible();

  await page.getByRole("link", { name: /ship ticketing foundation for launch review/i }).click();

  await expect(page).toHaveURL(/\/tickets\/ticket-alt1696/);
  await expect(page.getByRole("heading", { name: /ship ticketing foundation for launch review/i })).toBeVisible();
  await expect(page.getByText(/linked tasks/i)).toBeVisible();
  await expect(page.getByText(/activity stream/i)).toBeVisible();
});

test("renders the SLA dashboard and settings routes for ticketing", async ({ page }) => {
  await page.goto("/tickets/sla");

  await expect(page.getByRole("heading", { name: /ticketing sla dashboard/i })).toBeVisible();
  await page.getByRole("link", { name: /sla settings/i }).click();

  await expect(page).toHaveURL(/\/settings\/ticketing-sla/);
  await expect(page.getByRole("heading", { name: /sla policy editor/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /save changes/i })).toBeVisible();
});
