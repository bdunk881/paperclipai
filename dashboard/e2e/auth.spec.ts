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
  await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
});

test("sign-in button transitions to redirecting state when clicked", async ({ page }) => {
  await page.goto("/login");

  const signInButton = page.getByRole("button", { name: /^sign in$/i });
  await expect(signInButton).toBeVisible();
  await signInButton.click();

  await expect(page.getByRole("button", { name: /redirecting/i })).toBeDisabled();
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
