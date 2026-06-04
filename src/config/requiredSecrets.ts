/**
 * HEL-500: boot-time required-secret assertion.
 *
 * Several secrets are referenced in code but were absent from `.env.example`,
 * so local/dev/prod setups could silently degrade (passkey login 503, admin
 * console 500, secret-vault throws, WebAuthn failures). This mirrors HEL-262's
 * fail-fast for the connector encryption key, generalized to the rest.
 *
 * Tiering (deliberate — we must not crash production over a var we cannot
 * verify is set there):
 *   - REQUIRED: the app is non-functional without these and already throws/503s
 *     when they're missing. In production we fail fast at boot (exit 1) instead
 *     of serving broken responses. In non-production we only warn.
 *   - RECOMMENDED: these have safe fallbacks (localhost WebAuthn defaults; an
 *     in-process queue/rate-limit fallback). Missing them degrades a feature
 *     rather than breaking the app, so we always warn and never exit — even in
 *     production — to avoid taking the service down over an origin/Redis var.
 */

export interface SecretRequirement {
  name: string;
  gates: string;
}

export interface SecretCheckResult {
  missingRequired: SecretRequirement[];
  missingRecommended: SecretRequirement[];
}

type EnvLike = Record<string, string | undefined>;

const REQUIRED_IN_PRODUCTION: SecretRequirement[] = [
  {
    name: "SUPABASE_URL",
    gates:
      "Supabase JWT verification for dashboard Bearer tokens; unset → /api routes that verify JWTs return 503.",
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    gates:
      "Admin-console queries + passkey/session minting + password reset; unset → admin console 500, passkey login 503.",
  },
  {
    name: "CONTROL_PLANE_SECRET_KEY",
    gates:
      "AES-256-GCM envelope for provisioned company secrets and MCP auth headers; unset → throws on any secret read/write.",
  },
];

const RECOMMENDED_IN_PRODUCTION: SecretRequirement[] = [
  {
    name: "MFA_RP_ID",
    gates:
      'WebAuthn relying-party ID (eTLD+1). Falls back to "localhost" → passkeys fail on real origins.',
  },
  {
    name: "MFA_RP_NAME",
    gates: 'WebAuthn relying-party display name. Falls back to "AutoFlow".',
  },
  {
    name: "MFA_ORIGIN",
    gates:
      "WebAuthn expected origin(s). Falls back to http://localhost:5173 → passkeys fail on real origins.",
  },
];

function isSet(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * The queue/rate-limiter accept any one of: `REDIS_URL` (ioredis),
 * `UPSTASH_REDIS_URL` (ioredis over Upstash), or the Upstash REST pair
 * (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`). Configured if any
 * group is fully present.
 */
export function isRedisConfigured(env: EnvLike): boolean {
  if (isSet(env.REDIS_URL)) return true;
  if (isSet(env.UPSTASH_REDIS_URL)) return true;
  return isSet(env.UPSTASH_REDIS_REST_URL) && isSet(env.UPSTASH_REDIS_REST_TOKEN);
}

export function checkRequiredSecrets(env: EnvLike = process.env): SecretCheckResult {
  const missingRequired = REQUIRED_IN_PRODUCTION.filter((s) => !isSet(env[s.name]));
  const missingRecommended = RECOMMENDED_IN_PRODUCTION.filter((s) => !isSet(env[s.name]));

  if (!isRedisConfigured(env)) {
    missingRecommended.push({
      name: "REDIS_URL (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)",
      gates:
        "BullMQ run queue + distributed rate limiting; unset → in-process fallbacks only (no cross-instance durability).",
    });
  }

  return { missingRequired, missingRecommended };
}

export interface AssertOptions {
  env?: EnvLike;
  isProduction?: boolean;
  logger?: Pick<Console, "warn" | "error">;
  /** Injectable for tests; defaults to process.exit. */
  exit?: (code: number) => void;
}

/**
 * Logs missing recommended secrets (warn) and missing required secrets (error).
 * In production, exits the process when a required secret is unset. Returns the
 * check result so callers/tests can inspect it.
 */
export function assertRequiredSecrets(opts: AssertOptions = {}): SecretCheckResult {
  const env = opts.env ?? process.env;
  const isProduction =
    opts.isProduction ?? (env.NODE_ENV ?? "").trim().toLowerCase() === "production";
  const logger = opts.logger ?? console;
  const exit = opts.exit ?? ((code: number) => process.exit(code));

  const result = checkRequiredSecrets(env);

  for (const s of result.missingRecommended) {
    logger.warn(`[startup] Recommended secret unset: ${s.name} — ${s.gates}`);
  }

  if (result.missingRequired.length > 0) {
    for (const s of result.missingRequired) {
      logger.error(`[startup] Required secret unset: ${s.name} — ${s.gates}`);
    }
    if (isProduction) {
      logger.error(
        `[startup] Refusing to boot in production with ${result.missingRequired.length} required secret(s) unset.`,
      );
      exit(1);
    } else {
      logger.warn(
        `[startup] ${result.missingRequired.length} required secret(s) unset — tolerated in non-production (NODE_ENV=${env.NODE_ENV ?? "development"}).`,
      );
    }
  }

  return result;
}
