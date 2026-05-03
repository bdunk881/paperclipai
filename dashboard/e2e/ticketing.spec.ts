import { test, expect } from "@playwright/test";
import { loginAsMockUser } from "./helpers/auth";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
  const primaryAssignee = page.getByLabel(/primary assignee/i);
  const firstAssignableActor = await primaryAssignee.locator("option").evaluateAll((options) => {
    return (
      options
        .map((option) => option.getAttribute("value"))
        .find((value): value is string => Boolean(value)) ?? null
    );
  });
  expect(firstAssignableActor).not.toBeNull();
  await primaryAssignee.selectOption(firstAssignableActor!);
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
  const firstActorLink = page.locator('a[href^="/tickets/actors/agent/"]').first();
  await expect(firstActorLink).toBeVisible();
  const actorHref = await firstActorLink.getAttribute("href");
  expect(actorHref).toBeTruthy();
  await firstActorLink.click();

  await expect(page).toHaveURL(new RegExp(escapeRegExp(actorHref!)));
  await expect(page.getByText(/queue owner/i)).toBeVisible();

  const firstTicketLink = page.locator('a[href^="/tickets/ticket"]').first();
  await expect(firstTicketLink).toBeVisible();
  const ticketHref = await firstTicketLink.getAttribute("href");
  expect(ticketHref).toBeTruthy();
  const ticketTitle = await firstTicketLink.locator("h2").textContent();
  await firstTicketLink.click();

  await expect(page).toHaveURL(new RegExp(escapeRegExp(ticketHref!)));
  await expect(page.getByRole("heading", { name: new RegExp(escapeRegExp((ticketTitle ?? "").trim()), "i") })).toBeVisible();
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
