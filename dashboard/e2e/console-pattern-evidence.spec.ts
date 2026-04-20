import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.resolve(CURRENT_DIR, "../../artifacts/alt-1369");
const THEME_STORAGE_KEY = "autoflow:theme:v1";
const PATHS = ["/", "/builder", "/settings", "/pricing", "/memory"] as const;

function slugifyPath(input: string): string {
  if (input === "/") return "home";
  return input.replace(/^\//, "").replace(/\//g, "-");
}

for (const theme of ["light", "dark"] as const) {
  test(`evidence screenshots (${theme}) with clean console pattern checks`, async ({ page }) => {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
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

    await page.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [THEME_STORAGE_KEY, theme] as const
    );

    for (const targetPath of PATHS) {
      await page.goto(targetPath);
      await expect(page).toHaveURL(/\/login|\/pricing/);
      const shotPath = path.join(SHOT_DIR, `${theme}-${slugifyPath(targetPath)}.png`);
      await page.screenshot({ path: shotPath, fullPage: true });
    }

    expect(badMessages).toEqual([]);
  });
}
