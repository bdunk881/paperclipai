import { expect, test } from "@playwright/test";

test("auth regression: protected routes redirect to /login when unauthenticated", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/builder");
  await expect(page).toHaveURL(/\/login/);
});

test("auth regression: login CTA renders and starts redirect flow", async ({
  page,
}) => {
  await page.goto("/login");

  const signInButton = page.getByRole("button", { name: /^sign in$/i });
  await expect(signInButton).toBeVisible();

  await signInButton.click();

  try {
    await page.waitForURL(/ciamlogin\.com|login\.microsoftonline\.com/i, { timeout: 10_000 });
  } catch {
    await expect(signInButton).toBeDisabled({ timeout: 5_000 });
  }
});
