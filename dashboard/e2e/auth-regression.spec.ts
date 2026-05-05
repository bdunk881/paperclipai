import { expect, test } from "@playwright/test";

test("auth regression: protected routes redirect to /login when unauthenticated", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/builder");
  await expect(page).toHaveURL(/\/login/);
});

test("auth regression: login form renders the current Supabase auth contract", async ({
  page,
}) => {
  await page.goto("/login");

  const emailInput = page.locator('input[type="email"]').first();
  const signInButton = page.locator("form").getByRole("button", { name: /^sign in$/i });

  await expect(emailInput).toBeVisible();
  await expect(signInButton).toBeVisible();
  await expect(signInButton).toBeDisabled();
  await expect(page.getByText(/supabase auth is not configured yet/i)).toBeVisible();
});
