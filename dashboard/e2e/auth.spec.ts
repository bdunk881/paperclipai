/**
 * E2E: Authentication critical paths
 *
 * Covers: protected-route redirects, CIAM login surface, signup redirect,
 * and waitlist public access.
 */

import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Unauthenticated redirect
// ---------------------------------------------------------------------------

test("unauthenticated user visiting / is redirected to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("unauthenticated user visiting /builder is redirected to /login", async ({ page }) => {
  await page.goto("/builder");
  await expect(page).toHaveURL(/\/login/);
});

// ---------------------------------------------------------------------------
// Login page (MSAL / CIAM)
// ---------------------------------------------------------------------------

test("login page renders Microsoft sign-in CTA", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /sign in to autoflow/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /continue with microsoft/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /create account with email/i })).toBeVisible();
  await expect(page.getByText(/register with a personal email/i)).toBeVisible();
});

test("signup route redirects to login", async ({ page }) => {
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/login/);
});

test("sign-in button transitions to redirecting state when clicked", async ({ page }) => {
  await page.goto("/login");

  const signInButton = page.getByRole("button", { name: /continue with microsoft/i });
  await signInButton.click();

  // In CI mock runs the MSAL redirect is not completed; verify UI enters redirect state.
  await expect(page.getByRole("button", { name: /redirecting/i })).toBeVisible();
});

test("create-account button transitions to signup redirect state when clicked", async ({
  page,
}) => {
  await page.goto("/login");

  const createAccountButton = page.getByRole("button", {
    name: /create account with email/i,
  });
  await createAccountButton.click();

  await expect(page.getByRole("button", { name: /redirecting to sign-up/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Waitlist landing page
// ---------------------------------------------------------------------------

test("waitlist page is accessible without authentication", async ({ page }) => {
  await page.goto("/waitlist");
  await expect(page).toHaveURL("/waitlist");
  await expect(page.getByText(/AI Automation Platform/i)).toBeVisible();
});
