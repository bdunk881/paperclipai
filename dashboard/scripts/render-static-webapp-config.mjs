import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const templatePath = path.join(repoRoot, "staticwebapp.config.template.json");
const outputDir = path.join(repoRoot, "dist");
const outputPath = path.join(outputDir, "staticwebapp.config.json");

function normalizeHttpsOrigin(value) {
  if (typeof value !== "string") {
    throw new Error("VITE_API_BASE_URL is required for Azure Static Web Apps deploys.");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("VITE_API_BASE_URL is required for Azure Static Web Apps deploys.");
  }

  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:") {
    throw new Error(`VITE_API_BASE_URL must use https, received: ${trimmed}`);
  }

  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

const apiBaseUrl = normalizeHttpsOrigin(process.env.VITE_API_BASE_URL);
const template = await fs.readFile(templatePath, "utf8");
const rendered = template.replaceAll("__API_BASE_URL__", apiBaseUrl);

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputPath, rendered, "utf8");

console.log(`Rendered ${path.relative(repoRoot, outputPath)} for ${apiBaseUrl}`);
