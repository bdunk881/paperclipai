import { test, expect } from "@playwright/test";

test("preview smoke: login page renders with auth form", async ({ page }) => {
  const supabaseConfigWarnings: string[] = [];

  page.on("console", (message) => {
    const text = message.text();
    if (
      (message.type() === "warning" || message.type() === "error") &&
      (text.includes("VITE_SUPABASE_URL") || text.includes("VITE_SUPABASE_ANON_KEY"))
    ) {
      supabaseConfigWarnings.push(text);
    }
  });

  await page.goto("/login");
  await expect(page).toHaveURL(/\/login/);

  // Login page must render its heading and sign-in form
  await expect(page.getByRole("heading", { name: /sign in to autoflow/i })).toBeVisible();

  // At least one sign-in action must be present (email form or social button)
  const signInButton = page.getByRole("button", { name: /sign in/i }).first();
  await expect(signInButton).toBeVisible();

  // No unexpected console noise about missing Supabase config
  expect(supabaseConfigWarnings).toEqual([]);
});
