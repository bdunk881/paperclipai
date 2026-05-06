import process from "node:process";

export default async function globalTeardown() {
  if (!process.env.CI) {
    return;
  }

  setTimeout(() => {
    process.exit(process.exitCode ?? 0);
  }, 1000);
}
