/**
 * HEL-809 (parent HEL-807): run-isolation feature flag + Fly Machines target.
 *
 * RUN_ISOLATION selects how a workflow run executes:
 *   - "inline" (default): in the BullMQ worker process — today's behavior.
 *   - "fly-machine": dispatched to an ephemeral Fly Machine (wired in HEL-810+).
 *
 * Isolation is ENABLED only when the flag is "fly-machine" AND the Fly Machines
 * target is fully configured (token + app). A flag set without config falls back
 * to inline + warns once — a misconfiguration never breaks run execution.
 *
 * This module is config only; nothing here changes execution.
 */

export type RunIsolationMode = "inline" | "fly-machine";

export interface FlyRunTarget {
  token: string;
  app: string;
  region: string | undefined;
  baseUrl: string;
}

export const DEFAULT_FLY_MACHINES_BASE_URL = "https://api.machines.dev/v1";

export function getRunIsolationMode(): RunIsolationMode {
  return process.env.RUN_ISOLATION === "fly-machine" ? "fly-machine" : "inline";
}

/**
 * Resolve the Fly Machines target from env, or null if not fully configured.
 * Defaults `app` to the api app itself (Fly injects FLY_APP_NAME at runtime) so
 * isolated runs reuse the same image + secrets (per the HEL-807 spike).
 */
export function resolveFlyRunTarget(): FlyRunTarget | null {
  const token = process.env.FLY_MACHINES_TOKEN;
  const app = process.env.FLY_RUN_APP || process.env.FLY_APP_NAME;
  if (!token || !app) return null;
  return {
    token,
    app,
    region: process.env.FLY_RUN_REGION || process.env.FLY_REGION || undefined,
    baseUrl: process.env.FLY_MACHINES_BASE_URL || DEFAULT_FLY_MACHINES_BASE_URL,
  };
}

let warnedUnconfigured = false;

/**
 * True when runs should be dispatched to Fly Machines: the flag is on AND the
 * target is configured. Warns once if the flag is on but unconfigured.
 */
export function isRunIsolationEnabled(): boolean {
  if (getRunIsolationMode() !== "fly-machine") return false;
  if (resolveFlyRunTarget()) return true;
  if (!warnedUnconfigured) {
    warnedUnconfigured = true;
    console.warn(
      "[runIsolation] RUN_ISOLATION=fly-machine but FLY_MACHINES_TOKEN / app is unset — falling back to inline execution.",
    );
  }
  return false;
}

/** Test-only: reset the one-shot unconfigured warning. */
export function __resetRunIsolationWarningForTests(): void {
  warnedUnconfigured = false;
}
