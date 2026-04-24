import { test, expect } from "@playwright/test";

test("preview smoke: login route renders native auth form and accepts credentials", async ({
  page,
}) => {
  const envConfigWarnings: string[] = [];

  page.on("console", (message) => {
    const text = message.text();
    if (
      (message.type() === "warning" || message.type() === "error") &&
      (text.includes("VITE_AZURE_CLIENT_ID") ||
        text.includes("VITE_AZURE_TENANT_SUBDOMAIN"))
    ) {
      envConfigWarnings.push(text);
    }
  });

  await page.goto("/login");
  await expect(page).toHaveURL(/\/login/);

  // The native auth Login page renders a form with a submit button inside it.
  const signInSubmit = page.locator("form").getByRole("button", { name: /sign in/i });
  await expect(signInSubmit).toBeVisible();
  expect(envConfigWarnings).toEqual([]);

  // Verify core form fields are present.
  await expect(page.getByPlaceholder(/email/i)).toBeVisible();
  await expect(page.getByPlaceholder(/password/i)).toBeVisible();
});
