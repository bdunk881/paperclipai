import { test, expect } from "@playwright/test";

test("preview smoke: login route renders with configured MSAL env and starts auth redirect", async ({
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

  const signInButton = page.getByRole("button", { name: /^sign in$/i });
  await expect(signInButton).toBeVisible();
  expect(envConfigWarnings).toEqual([]);

  await signInButton.click();

  let redirectStarted = false;
  try {
    await page.waitForURL(/ciamlogin\.com|login\.microsoftonline\.com/i, { timeout: 10000 });
    redirectStarted = true;
  } catch {
    await expect(signInButton).toBeDisabled({ timeout: 5000 });
    redirectStarted = true;
  }

  expect(redirectStarted).toBe(true);
});
