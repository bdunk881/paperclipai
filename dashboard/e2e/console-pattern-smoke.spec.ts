import { expect, test } from "@playwright/test";

test("five-page smoke: no 'expected pattern' runtime errors", async ({ page }) => {
  const badMessages: string[] = [];

  page.on("console", (message) => {
    const text = message.text();
    if (
      (message.type() === "error" || message.type() === "warning") &&
      /the string did not match the expected pattern/i.test(text)
    ) {
      badMessages.push(text);
    }
  });

  page.on("pageerror", (error) => {
    const text = String(error?.message ?? error);
    if (/the string did not match the expected pattern/i.test(text)) {
      badMessages.push(text);
    }
  });

  const paths = ["/", "/builder", "/settings", "/pricing", "/memory"];
  for (const path of paths) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login|\/pricing/);
  }

  expect(badMessages).toEqual([]);
});
