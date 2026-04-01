import type { Page } from "@playwright/test";

/**
 * Seeds localStorage with a fake user so E2E tests skip the login flow
 * and land directly on the authenticated dashboard.
 *
 * The AuthContext initialises from localStorage on first render, so this
 * must be called before navigating to a protected route.
 */
export async function loginAsMockUser(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      "autoflow_user",
      JSON.stringify({ id: "usr-e2e", email: "e2e@example.com", name: "E2E User" })
    );
  });
}
