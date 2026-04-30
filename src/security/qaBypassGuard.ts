/**
 * QA bypass guard (ALT-2078 / ALT-1915 Phase 5).
 *
 * Three responsibilities:
 *
 *   1. Enumerate every QA / test / bypass flag that can short-circuit auth,
 *      RLS, or workspace context. The list is the authoritative inventory
 *      audited under the Phase 5 acceptance criteria.
 *
 *   2. Provide a single helper (`isQaBypassActive`) that callsites use instead
 *      of reading the env vars directly. The helper returns `false` in
 *      production regardless of the flag value, so a stray production env var
 *      cannot enable the bypass behaviour at runtime.
 *
 *   3. Provide `assertProductionSafety` that the bootstrap calls before the
 *      app starts listening. If the process is starting in production with any
 *      bypass flag asserted, it throws and refuses to boot.
 *
 * Production is defined as `process.env.NODE_ENV === 'production'` OR the env
 * var being absent (the safer default - missing config should fail closed,
 * not open).
 */

export interface BypassFlagDefinition {
  /** Env var name that activates the bypass when truthy. */
  envVar: string;
  /** Free-form description of what isolation this flag relaxes. */
  description: string;
  /**
   * Predicate: given a value snapshot, decide whether the flag would be
   * treated as active by the consuming callsite. Defaults to `=== "true"` so
   * the inventory matches the actual gate code.
   */
  isActive?: (value: string | undefined) => boolean;
}

const truthyExact = (value: string | undefined): boolean => value === "true";

/**
 * Authoritative inventory of bypass flags. Adding a new bypass MUST add a row
 * here so the production-boot guard refuses to start with it set.
 */
export const QA_BYPASS_FLAGS: ReadonlyArray<BypassFlagDefinition> = [
  {
    envVar: "QA_AUTH_BYPASS_ENABLED",
    description:
      "Auth middleware: when true, allows requests bearing only x-user-id (no JWT) for IDs in QA_AUTH_BYPASS_USER_IDS",
    isActive: truthyExact,
  },
  {
    envVar: "QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW",
    description:
      "Dashboard QA preview-access endpoint: when true, accepts the preview token outside Vercel preview deployments",
    isActive: truthyExact,
  },
];

export function isQaBypassActive(flag: BypassFlagDefinition): boolean {
  if (isProductionEnvironment()) {
    return false;
  }
  const predicate = flag.isActive ?? truthyExact;
  return predicate(process.env[flag.envVar]);
}

export function isQaBypassEnabledByName(envVar: string): boolean {
  const flag = QA_BYPASS_FLAGS.find((entry) => entry.envVar === envVar);
  if (!flag) {
    return false;
  }
  return isQaBypassActive(flag);
}

export function isProductionEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  // Treat a missing NODE_ENV as production for the purpose of bypass safety.
  // The cost of refusing to boot a misconfigured local env is far lower than
  // the cost of silently relaxing isolation in a forgotten production env.
  const value = env.NODE_ENV?.trim().toLowerCase();
  return !value || value === "production";
}

export function listActiveBypassFlags(
  env: NodeJS.ProcessEnv = process.env,
): BypassFlagDefinition[] {
  return QA_BYPASS_FLAGS.filter((flag) => {
    const predicate = flag.isActive ?? truthyExact;
    return predicate(env[flag.envVar]);
  });
}

/**
 * Throws if the process is starting in production with any bypass flag set.
 *
 * Called from `bootstrap.ts` before the HTTP server begins listening. The
 * thrown error is fatal: the parent process logs and exits.
 */
export function assertProductionSafety(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isProductionEnvironment(env)) {
    return;
  }
  const active = listActiveBypassFlags(env);
  if (active.length === 0) {
    return;
  }
  const flagList = active
    .map((flag) => `${flag.envVar} (${flag.description})`)
    .join("; ");
  throw new Error(
    `Refusing to boot in production with QA bypass flags asserted: ${flagList}. ` +
      `Unset these env vars or run with NODE_ENV != "production".`,
  );
}
