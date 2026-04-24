import type { Page } from "@playwright/test";

/**
 * Seeds sessionStorage with a fake auth session so protected routes can call
 * requireAccessToken() without redirecting back to /login.
 *
 * The AuthContext initialises from sessionStorage on first render, so this
 * must be called before navigating to a protected route.
 */
export async function loginAsMockUser(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const user = { id: "usr-e2e", email: "e2e@example.com", name: "E2E User" };

    sessionStorage.setItem("autoflow_user", JSON.stringify(user));
    sessionStorage.setItem(
      "autoflow_auth_session",
      JSON.stringify({
        accessToken: "mock-access-token",
        expiresAt: Date.now() + 60 * 60 * 1000,
        user,
      })
    );
    localStorage.setItem("autoflow:onboarding-dismissed:v1:usr-e2e", "true");
  });
}
