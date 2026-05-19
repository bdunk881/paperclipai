import { expect, test } from "@playwright/test";
import { loginAsMockUser } from "./helpers/auth";

const TARGET_VIEWPORTS = [375, 768, 1024, 1440] as const;

test.describe("Workflow Studio responsive layout", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsMockUser(page);
  });

  for (const width of TARGET_VIEWPORTS) {
    test(`keeps Studio actions and sheets usable at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 820 });
      await page.goto("/builder/tpl-support-bot");

      const shell = page.getByTestId("workflow-studio-shell");
      const runButton = page.getByRole("button", { name: /^run$/i });
      const copilotButton = page.getByRole("button", { name: /copilot/i });

      await expect(shell).toBeVisible({ timeout: 10_000 });
      await expect(runButton).toBeVisible();
      await expect(copilotButton).toBeVisible();

      await page.getByText("Intake ticket").click();
      const inspector = page.getByTestId("workflow-inspector-panel");
      await expect(inspector).toBeVisible();
      await expect(shell).toHaveAttribute("data-inspector-open", "true");

      await copilotButton.click();
      const copilot = page.getByTestId("workflow-copilot-panel");
      await expect(copilot).toBeVisible();
      await expect(shell).toHaveAttribute("data-copilot-open", "true");
      await expect(runButton).toBeVisible();
      await page.waitForTimeout(250);

      const horizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(horizontalOverflow).toBeLessThanOrEqual(2);

      const viewportWidth = page.viewportSize()?.width ?? width;
      const inspectorBox = await inspector.boundingBox();
      const copilotBox = await copilot.boundingBox();

      expect(inspectorBox).not.toBeNull();
      expect(copilotBox).not.toBeNull();
      expect(inspectorBox!.x).toBeGreaterThanOrEqual(0);
      expect(inspectorBox!.x + inspectorBox!.width).toBeLessThanOrEqual(viewportWidth + 1);
      expect(copilotBox!.x).toBeGreaterThanOrEqual(0);
      expect(copilotBox!.x + copilotBox!.width).toBeLessThanOrEqual(viewportWidth + 1);

      await testInfo.attach(`workflow-studio-${width}px`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    });
  }

  test("parks the inspector beside Copilot only on wide desktop", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 820 });
    await page.goto("/builder/tpl-support-bot");

    await expect(page.getByTestId("workflow-studio-shell")).toBeVisible({ timeout: 10_000 });
    await page.getByText("Intake ticket").click();
    await page.getByRole("button", { name: /copilot/i }).click();
    await page.waitForTimeout(250);

    const inspectorBox = await page.getByTestId("workflow-inspector-panel").boundingBox();
    const copilotBox = await page.getByTestId("workflow-copilot-panel").boundingBox();

    expect(inspectorBox).not.toBeNull();
    expect(copilotBox).not.toBeNull();
    expect(inspectorBox!.x + inspectorBox!.width).toBeLessThanOrEqual(copilotBox!.x + 1);

    await testInfo.attach("workflow-studio-wide-dual-panel", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
});
