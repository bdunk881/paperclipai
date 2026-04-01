/**
 * E2E: Authentication critical paths
 *
 * Covers: landing → login flow, protected route redirect,
 * login success → dashboard, logout.
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

test("login page renders email and password fields", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});

test("successful login navigates to dashboard", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel(/email/i).fill("user@example.com");
  await page.getByLabel(/password/i).fill("anypassword");
  await page.getByRole("button", { name: /sign in/i }).click();

  // AuthContext has a 600ms simulated delay — wait for navigation
  await expect(page).toHaveURL("/", { timeout: 5000 });
  await expect(page.getByText(/autoflow/i).first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

test("logout returns user to login page", async ({ page }) => {
  // Seed localStorage to skip login flow
  await page.addInitScript(() => {
    localStorage.setItem(
      "autoflow_user",
      JSON.stringify({ id: "usr-e2e", email: "e2e@example.com", name: "E2E User" })
    );
  });

  await page.goto("/");
  await expect(page).toHaveURL("/");

  // Click logout button in the sidebar/nav
  await page.getByRole("button", { name: /log out/i }).click();
  await expect(page).toHaveURL(/\/login/);
});

// ---------------------------------------------------------------------------
// Waitlist landing page
// ---------------------------------------------------------------------------

test("waitlist page is accessible without authentication", async ({ page }) => {
  await page.goto("/waitlist");
  await expect(page).toHaveURL("/waitlist");
  await expect(page.getByText(/AI Automation Platform/i)).toBeVisible();
});
