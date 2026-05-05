/**
 * E2E: Authentication critical paths
 *
 * Covers: protected route redirect, login CTA,
 * and redirecting-state UX on auth actions.
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
// Login page
// ---------------------------------------------------------------------------

test("login page renders AutoFlow sign-in CTA", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("form").getByRole("button", { name: /^sign in$/i })).toBeVisible();
});

test("sign-in form shows the current Supabase setup state", async ({ page }) => {
  await page.goto("/login");

  const emailInput = page.locator('input[type="email"]').first();
  const signInButton = page.locator("form").getByRole("button", { name: /^sign in$/i });

  await expect(emailInput).toBeVisible();
  await expect(signInButton).toBeVisible();
  await expect(signInButton).toBeDisabled();
  await expect(page.getByText(/supabase auth is not configured yet/i)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Signup entry points
// ---------------------------------------------------------------------------

test("signup route redirects to login", async ({ page }) => {
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/login/);
});

// ---------------------------------------------------------------------------
// Waitlist landing page
// ---------------------------------------------------------------------------

test("waitlist page is accessible without authentication", async ({ page }) => {
  await page.goto("/waitlist");
  await expect(page).toHaveURL("/waitlist");
  await expect(page.getByText(/Runs Your Operations/i)).toBeVisible();
});
