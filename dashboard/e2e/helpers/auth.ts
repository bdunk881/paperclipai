import type { Page } from "@playwright/test";

/**
 * Seeds storage with a fake authenticated session so E2E tests skip the
 * login flow and land directly on the protected dashboard.
 *
 * The dashboard is in the middle of an auth migration, so tests seed both
 * the legacy `autoflow_user` key and the newer native-auth session keys.
 */
export async function loginAsMockUser(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const user = { id: "usr-e2e", email: "e2e@example.com", name: "E2E User" };
    const session = {
      accessToken: "e2e-access-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
      user,
    };

    localStorage.setItem("autoflow_user", JSON.stringify(user));
    sessionStorage.setItem("autoflow_user", JSON.stringify(user));
    sessionStorage.setItem("autoflow_auth_session", JSON.stringify(session));
    localStorage.setItem("autoflow:onboarding-dismissed:v1:usr-e2e", "true");
  });
}
