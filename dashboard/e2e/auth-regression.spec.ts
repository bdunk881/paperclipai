import { expect, test } from "@playwright/test";

test("auth regression: protected routes redirect to /login when unauthenticated", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/builder");
  await expect(page).toHaveURL(/\/login/);
});

test("auth regression: login CTA renders and validates the native auth form", async ({
  page,
}) => {
  await page.goto("/login");

  const signInButton = page.locator("form").getByRole("button", { name: /^sign in$/i });
  await expect(signInButton).toBeVisible();

  await signInButton.click();
  await expect(page.getByText(/enter both your email and password\./i)).toBeVisible();
});
