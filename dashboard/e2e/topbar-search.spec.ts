import { expect, test, type Page } from "@playwright/test";
import { loginAsMockUser } from "./helpers/auth";

const SEARCH_RESULTS = [
  {
    type: "agent",
    id: "agent-1",
    title: "Revenue Analyst",
    subtitle: "Sales Ops",
    status: "active",
    route: "/agents/agent-1",
    matchedFields: ["name"],
    updatedAt: "2026-05-19T16:00:00.000Z",
  },
  {
    type: "approval",
    id: "approval-1",
    title: "Approve renewal outreach",
    subtitle: "Approvals desk",
    status: "pending",
    route: "/approvals?approval=approval-1",
    matchedFields: ["step"],
    updatedAt: "2026-05-19T15:00:00.000Z",
  },
];

const DASHBOARD_BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

async function stubSearchApi(page: Page): Promise<void> {
  await page.route(/\/api\/search(?:\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        query: url.searchParams.get("q") ?? "",
        total: SEARCH_RESULTS.length,
        results: SEARCH_RESULTS,
      }),
    });
  });
}

test.describe("topbar search command palette", () => {
  test.beforeEach(async ({ page }) => {
    await stubSearchApi(page);
    await loginAsMockUser(page);
  });

  test("desktop users can launch from the topbar and keyboard-select a result", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto(`${DASHBOARD_BASE}/mission-state`);

    await expect(page.getByTestId("app-topbar")).toBeVisible();
    await page
      .getByRole("button", { name: "Search agents, missions, assignments, runs" })
      .click();
    await expect(page.getByRole("dialog", { name: "Search AutoFlow" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Search AutoFlow" }).fill("revenue");
    await expect(page.getByRole("option", { name: /Revenue Analyst/i })).toBeVisible();

    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/agents\/agent-1$/);
  });

  test("mobile users can open search and route from a result", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${DASHBOARD_BASE}/mission-state`);

    await expect(page.getByTestId("app-topbar")).toBeVisible();
    await page.getByRole("button", { name: "Open search" }).click();
    await expect(page.getByRole("dialog", { name: "Search AutoFlow" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Search AutoFlow" }).fill("approval");
    await page.getByRole("option", { name: /Approve renewal outreach/i }).click();

    await expect(page).toHaveURL(/\/approvals\?approval=approval-1$/);
  });
});
