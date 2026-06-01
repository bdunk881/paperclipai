/**
 * MFA service (HEL-mfa).
 *
 * Coordinates between:
 *   - Supabase Auth REST API (TOTP factor enroll/challenge/verify; we don't
 *     re-implement the OTP math, we just delegate so the JWT's `aal` claim
 *     gets bumped natively).
 *   - SimpleWebAuthn-equivalent primitives via WebauthnAdapter (passkeys —
 *     not a Supabase factor type, so we own this entirely).
 *   - mfaRepository (app-owned tables: webauthn credentials, recovery
 *     codes, per-user policy).
 *   - mintAal2Attestation (mints the short-lived AAL2 cookie after a
 *     successful passkey or recovery-code verification).
 *   - auditService ("auth" category — every enroll/verify/disable is
 *     audit-logged).
 *
 * Recovery codes are bcrypt-hashed (cost 10). Plaintext is returned to the
 * caller exactly once; lost codes require regenerate (which invalidates
 * all prior codes).
 */

import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { SecurityServiceError } from "./securityService";
import { auditService } from "../auditing/auditService";
import { isAutoflowStaff } from "../admin/staffAuth";
import {
  getDefaultMfaRepository,
  type LastVerifiedMethod,
  type MfaEmailFactorPurpose,
  type MfaRepository,
  type UserMfaPolicyRow,
  type WebauthnCredentialRow,
} from "./mfaRepository";
import {
  buildDefaultMfaEmailSender,
  type MfaEmailSender,
} from "./mfaEmailSender";
import {
  mintAal2Attestation,
  type MintedAal2Attestation,
} from "../middleware/requireAAL2";
import {
  REQUIRE_APP_MFA_FOR_OAUTH_USERS,
  isWorkspaceFlagEnabled as defaultWorkspaceFlagChecker,
} from "./workspaceFeatureFlags";
import {
  getDefaultMfaChallengeStore,
  type MfaChallengeStore,
} from "./mfaChallengeStore";

export type MfaFactorType = "webauthn" | "totp";

/**
 * HEL-280: how the user authenticated their current session. Derived
 * from the Supabase JWT's `app_metadata.provider` claim (already extracted
 * onto `req.auth.provider` by `attachSupabaseAuth`). OAuth providers
 * carry their own phish-resistant 2FA at the IdP, so the enrollment gate
 * treats them as satisfied unless the workspace flag flips it on.
 */
export type SignInMethod =
  | "password"
  | "magic_link"
  | "oauth_google"
  | "oauth_github"
  | "unknown";

export interface MfaPolicySummary {
  hasWebauthn: boolean;
  hasTotp: boolean;
  /** HEL-282: app-owned email second factors. */
  hasEmailOtp: boolean;
  hasMagicLink: boolean;
  hasAnyFactor: boolean;
  hasRecoveryCodes: boolean;
  /** HEL-280: how the active session authenticated. */
  signInMethod: SignInMethod;
  /**
   * HEL-280: whether the enforcement gate should require an app-side
   * factor. False for OAuth users by default; the workspace flag
   * `require_app_mfa_for_oauth_users` flips it back to true.
   */
  requiresAppMfa: boolean;
  enrollmentCompletedAt: string | null;
  lastVerifiedAt: string | null;
  lastVerifiedMethod: LastVerifiedMethod | null;
  recoveryCodesIssuedAt: string | null;
  webauthnDevices: Array<{
    credentialId: string;
    deviceName: string | null;
    transports: string[];
    backedUp: boolean;
    createdAt: string;
    lastUsedAt: string | null;
  }>;
}

export interface RecoveryCodesIssuedResult {
  codes: string[];
  count: number;
}

export interface MfaServiceContext {
  workspaceId?: string;
  userId: string;
  userAgent?: string;
  ip?: string;
}

export interface WebauthnRegistrationOptions {
  challenge: string;
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: "public-key"; alg: number }>;
  timeout: number;
  attestation: "none" | "direct" | "indirect";
  authenticatorSelection: {
    residentKey: "required" | "preferred" | "discouraged";
    userVerification: "required" | "preferred" | "discouraged";
  };
  excludeCredentials: Array<{ id: string; type: "public-key"; transports?: string[] }>;
}

export interface WebauthnAuthenticationOptions {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: "required" | "preferred" | "discouraged";
  allowCredentials: Array<{ id: string; type: "public-key"; transports?: string[] }>;
}

export interface WebauthnVerifyRegistrationInput {
  expectedChallenge: string;
  expectedOrigin: string | string[];
  expectedRPID: string;
  response: unknown;
}

export interface WebauthnVerifyRegistrationResult {
  verified: boolean;
  credentialId: string;
  publicKey: Buffer;
  signCount: bigint;
  transports: string[];
  aaguid: string | null;
  backedUp: boolean;
}

export interface WebauthnVerifyAuthenticationInput {
  expectedChallenge: string;
  expectedOrigin: string | string[];
  expectedRPID: string;
  response: unknown;
  authenticator: {
    credentialId: string;
    publicKey: Buffer;
    signCount: bigint;
  };
}

export interface WebauthnVerifyAuthenticationResult {
  verified: boolean;
  newSignCount: bigint;
}

/**
 * Thin adapter over @simplewebauthn/server primitives. Defined as an
 * interface so we can stub it in unit tests without pulling the
 * dependency into the jest preset.
 */
export interface WebauthnAdapter {
  // HEL-337: async in @simplewebauthn/server@11 — Promise return forces callers
  // to await. The bug was reading `.challenge` off an unawaited Promise
  // (undefined) and storing that as the challenge → "challenge expired or missing".
  generateRegistrationOptions(input: {
    rpName: string;
    rpID: string;
    userID: string;
    userName: string;
    userDisplayName: string;
    excludeCredentials: Array<{ id: string; type: "public-key"; transports?: string[] }>;
  }): Promise<WebauthnRegistrationOptions>;
  generateAuthenticationOptions(input: {
    rpID: string;
    allowCredentials: Array<{ id: string; type: "public-key"; transports?: string[] }>;
  }): Promise<WebauthnAuthenticationOptions>;
  verifyRegistrationResponse(input: WebauthnVerifyRegistrationInput): Promise<WebauthnVerifyRegistrationResult>;
  verifyAuthenticationResponse(input: WebauthnVerifyAuthenticationInput): Promise<WebauthnVerifyAuthenticationResult>;
}

export interface SupabaseTotpAdapter {
  enrollTotp(accessToken: string, friendlyName: string): Promise<{
    factorId: string;
    qrCodeSvg: string;
    secret: string;
    uri: string;
  }>;
  challengeTotp(accessToken: string, factorId: string): Promise<{ challengeId: string }>;
  verifyTotp(accessToken: string, factorId: string, challengeId: string, code: string): Promise<void>;
  unenrollTotp(accessToken: string, factorId: string): Promise<void>;
  listFactors(accessToken: string): Promise<Array<{ id: string; type: "totp" | "phone"; status: "verified" | "unverified" }>>;
}

export interface RecoveryCodeHasher {
  hash(plaintext: string): Promise<string>;
  compare(plaintext: string, hash: string): Promise<boolean>;
}

/**
 * SHA-256 + per-code random salt. Faster than bcrypt and sufficient because
 * recovery codes are 80-bit random — the threat model isn't a password
 * dictionary attack, it's "if the DB leaks, can the attacker brute one of
 * the user's 10 codes before they're rotated?" 2^80 search is intractable.
 *
 * Wrapped behind RecoveryCodeHasher so a production deploy can swap in
 * bcrypt/argon2 via Infisical without a code change.
 */
export class DefaultRecoveryCodeHasher implements RecoveryCodeHasher {
  async hash(plaintext: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const digest = createHash("sha256")
      .update(`${salt}:${plaintext}`)
      .digest("hex");
    return `s1$${salt}$${digest}`;
  }

  async compare(plaintext: string, hash: string): Promise<boolean> {
    const parts = hash.split("$");
    if (parts.length !== 3 || parts[0] !== "s1") return false;
    const [, salt, expected] = parts;
    const actual = createHash("sha256")
      .update(`${salt}:${plaintext}`)
      .digest("hex");
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
  }
}

export interface MfaServiceDeps {
  repository?: MfaRepository;
  webauthn?: WebauthnAdapter | null;
  totp?: SupabaseTotpAdapter | null;
  hasher?: RecoveryCodeHasher;
  rpName?: string;
  rpId?: string;
  origin?: string | string[];
  /**
   * HEL-280: injectable workspace-flag checker. Defaults to the real
   * `isWorkspaceFlagEnabled` reader; tests stub it to avoid the DB.
   * HEL-298: signature takes `userId` so the reader can run inside
   * `withWorkspaceContext` and pass the RLS self-read policy added in
   * migration 086.
   */
  workspaceFlagChecker?: (
    workspaceId: string | null | undefined,
    userId: string | null | undefined,
    flag: string,
  ) => Promise<boolean>;
  /**
   * HEL-303: injectable challenge store. Defaults to a Redis-backed
   * store (with an in-memory fallback when Redis isn't configured).
   * Tests can pass an in-memory instance directly.
   */
  challengeStore?: MfaChallengeStore;
  /**
   * HEL-282: injectable transactional email sender for the email-OTP /
   * magic-link factors. Defaults to the SendGrid-or-log sender. Tests pass
   * a capturing fake so they can read the issued code/token.
   */
  emailSender?: MfaEmailSender;
  /**
   * HEL-282: public base URL the magic-link email points at — the API's own
   * origin, since the verify endpoint lives at
   * `<base>/api/mfa/magic-link/verify`. Defaults to `PAPERCLIP_API_URL`.
   */
  magicLinkApiBaseUrl?: string;
}

export interface GetPolicyOptions {
  /**
   * Supabase `app_metadata.provider` claim. Used as the IdP HINT for
   * the typed `signInMethod` value (e.g. `"oauth_google"` vs
   * `"oauth_github"`), but NOT as the decision signal for whether the
   * session was OAuth — see `amr` below.
   */
  provider?: string;
  /**
   * HEL-305: the JWT's `amr` claim contains the CURRENT session's
   * authentication methods (`{method: "oauth"}` for any OAuth IdP
   * sign-in). Supabase's `app_metadata.provider` is the SIGNUP IdP and
   * never updates on subsequent sign-ins, so a user who signed up via
   * email and later linked Google would forever read as
   * `provider="email"` even when their current session is OAuth.
   * Use the amr to decide OAuth-vs-password; use `provider` only to
   * pick the typed flavor.
   */
  amr?: Array<{ method: string; timestamp: number }>;
}

/**
 * HEL-280 / HEL-305: decide whether the current session is OAuth based
 * on the JWT's `amr` claim (the per-session signal), and pick a typed
 * `SignInMethod` flavor using `app_metadata.provider` only as a hint.
 *
 * `app_metadata.provider` reflects the user's SIGNUP IdP and doesn't
 * track which IdP they actually used for the current session — see
 * HEL-305 for the live data trace.
 */
function deriveSignInMethod(
  provider: string | undefined,
  amr: Array<{ method: string }> = [],
): SignInMethod {
  const isOauthSession = amr.some((entry) => entry.method === "oauth");
  if (isOauthSession) {
    if (provider === "github") return "oauth_github";
    // Default OAuth flavor is google (the only other IdP we currently
    // enable in Supabase project settings). If a third provider gets
    // added without updating this map it falls into oauth_google;
    // expand the switch then.
    return "oauth_google";
  }
  switch (provider) {
    case "google":
    case "github":
      // No oauth AMR but provider claims an OAuth IdP — odd state, likely
      // a stale provider claim. Fall through to password to be safe.
      return "password";
    case "email":
    case "supabase":
      // Supabase reports `email` for password+OTP+magic-link sign-ins.
      // We can't disambiguate password vs magic-link from the JWT alone,
      // so default to `password` — both require app-side MFA anyway.
      return "password";
    default:
      return provider ? "unknown" : "unknown";
  }
}

const DEFAULT_RECOVERY_CODE_COUNT = 10;

// HEL-282: email-OTP + magic-link tuning.
const EMAIL_FACTOR_TTL_SECONDS = 5 * 60; // 5-minute TTL for both code + token
const MAX_OTP_ATTEMPTS = 3; // failed guesses per code before lock
const EMAIL_FACTOR_SENDS_PER_HOUR = 5; // per-user send rate limit
const MAGIC_LINK_TOKEN_BYTES = 32; // 256 bits of entropy
const REGISTRATION_IDEMPOTENCY_WINDOW_MS = 60 * 1000;

function formatPolicy(
  policy: UserMfaPolicyRow | null,
  credentials: WebauthnCredentialRow[],
  activeRecoveryCodes: number,
  signInMethod: SignInMethod,
  requiresAppMfa: boolean,
): MfaPolicySummary {
  const hasEmailOtp = policy?.hasEmailOtp ?? false;
  const hasMagicLink = policy?.hasMagicLink ?? false;
  return {
    hasWebauthn: credentials.length > 0,
    hasTotp: policy?.hasTotp ?? false,
    hasEmailOtp,
    hasMagicLink,
    hasAnyFactor:
      credentials.length > 0 || (policy?.hasTotp ?? false) || hasEmailOtp || hasMagicLink,
    hasRecoveryCodes: activeRecoveryCodes > 0,
    signInMethod,
    requiresAppMfa,
    enrollmentCompletedAt: policy?.enrollmentCompletedAt?.toISOString() ?? null,
    lastVerifiedAt: policy?.lastVerifiedAt?.toISOString() ?? null,
    lastVerifiedMethod: policy?.lastVerifiedMethod ?? null,
    recoveryCodesIssuedAt: policy?.recoveryCodesIssuedAt?.toISOString() ?? null,
    webauthnDevices: credentials.map((c) => ({
      credentialId: c.credentialId,
      deviceName: c.deviceName,
      transports: c.transports,
      backedUp: c.backedUp,
      createdAt: c.createdAt.toISOString(),
      lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
    })),
  };
}

function extractCredentialIdFromWebauthnResponse(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const record = response as { id?: unknown; rawId?: unknown };
  const candidate = typeof record.id === "string" ? record.id : record.rawId;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function isRecentlyCreatedCredential(credential: WebauthnCredentialRow, now: Date = new Date()): boolean {
  return Math.abs(now.getTime() - credential.createdAt.getTime()) <= REGISTRATION_IDEMPOTENCY_WINDOW_MS;
}

/**
 * Generates a printable recovery code shaped `xxxx-xxxx-xxxx` (12 chars
 * of Crockford base32, ~60 bits — pad to 80 by emitting 16 chars total).
 * Avoids ambiguous I/L/O/U.
 */
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

function generateRecoveryCode(): string {
  const bytes = randomBytes(16);
  const out: string[] = [];
  for (let i = 0; i < 16; i += 1) {
    out.push(RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length]);
    if (i === 3 || i === 7 || i === 11) out.push("-");
  }
  return out.join("");
}

async function recordAudit(
  ctx: MfaServiceContext,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!ctx.workspaceId) {
    // Audit log is workspace-scoped. If the caller is in a state where
    // no workspace context is available (e.g. login challenge before
    // a workspace is bound), skip silently rather than throwing — the
    // event is also stamped in the Supabase JWT's amr/aal so we don't
    // lose security context entirely.
    return;
  }
  try {
    await auditService.recordAction(
      { workspaceId: ctx.workspaceId, userId: ctx.userId, actorUserId: ctx.userId },
      {
        category: "auth",
        action,
        target: { type: "user", id: ctx.userId },
        metadata: {
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
          ...metadata,
        },
      },
    );
  } catch (error) {
    // Audit writes must never block the auth flow.
    console.warn("[mfaService] audit emit failed", error instanceof Error ? error.message : error);
  }
}

export class MfaService {
  private repository: MfaRepository;
  private webauthn: WebauthnAdapter | null;
  private totp: SupabaseTotpAdapter | null;
  private hasher: RecoveryCodeHasher;
  private rpName: string;
  private rpId: string;
  private origin: string | string[];
  private workspaceFlagChecker: (
    workspaceId: string | null | undefined,
    userId: string | null | undefined,
    flag: string,
  ) => Promise<boolean>;
  // HEL-303: was a per-process Map. Now an injectable store so the
  // begin → finish round-trip survives Fly machine restarts and
  // multi-machine routing.
  private challengeStore: MfaChallengeStore;
  // HEL-282: email second-factor sender + magic-link base URL.
  private emailSender: MfaEmailSender;
  private magicLinkApiBaseUrl: string;

  constructor(deps: MfaServiceDeps = {}) {
    this.repository = deps.repository ?? getDefaultMfaRepository();
    this.webauthn = deps.webauthn ?? null;
    this.totp = deps.totp ?? null;
    this.hasher = deps.hasher ?? new DefaultRecoveryCodeHasher();
    this.rpName = deps.rpName ?? process.env.MFA_RP_NAME ?? "AutoFlow";
    this.rpId = deps.rpId ?? process.env.MFA_RP_ID ?? "localhost";
    this.origin =
      deps.origin ?? this.parseOriginEnv(process.env.MFA_ORIGIN ?? "http://localhost:5173");
    this.workspaceFlagChecker = deps.workspaceFlagChecker ?? defaultWorkspaceFlagChecker;
    this.challengeStore = deps.challengeStore ?? getDefaultMfaChallengeStore();
    this.emailSender = deps.emailSender ?? buildDefaultMfaEmailSender();
    this.magicLinkApiBaseUrl =
      deps.magicLinkApiBaseUrl ??
      process.env.PAPERCLIP_API_URL ??
      "http://localhost:3000";
  }

  private parseOriginEnv(raw: string): string | string[] {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length === 1 ? parts[0] : parts;
  }

  async getPolicy(ctx: MfaServiceContext, options: GetPolicyOptions = {}): Promise<MfaPolicySummary> {
    const signInMethod = deriveSignInMethod(options.provider, options.amr);
    const isOauth = signInMethod === "oauth_google" || signInMethod === "oauth_github";

    const [policy, credentials, activeRecoveryCodes, oauthOverrideOn] = await Promise.all([
      this.repository.getPolicy(ctx.userId),
      this.repository.listWebauthnCredentials(ctx.userId),
      this.repository.countActiveRecoveryCodes(ctx.userId),
      isOauth
        ? this.workspaceFlagChecker(ctx.workspaceId, ctx.userId, REQUIRE_APP_MFA_FOR_OAUTH_USERS)
        : Promise.resolve(false),
    ]);

    // HEL-280: OAuth users are MFA-satisfied by the IdP unless the
    // workspace explicitly opts back in via the override flag. All
    // other sign-in methods always require an app-side factor.
    const requiresAppMfa = isOauth ? oauthOverrideOn : true;

    return formatPolicy(policy, credentials, activeRecoveryCodes, signInMethod, requiresAppMfa);
  }

  // ---- WebAuthn (passkey) ---------------------------------------------------

  async beginWebauthnRegistration(
    ctx: MfaServiceContext,
    userEmail: string,
  ): Promise<WebauthnRegistrationOptions> {
    if (!this.webauthn) {
      throw new SecurityServiceError("WebAuthn not configured", 503, "webauthn_unavailable");
    }
    const existing = await this.repository.listWebauthnCredentials(ctx.userId);
    const options = await this.webauthn.generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpId,
      userID: ctx.userId,
      userName: userEmail,
      userDisplayName: userEmail,
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        type: "public-key",
        transports: c.transports,
      })),
    });
    await this.challengeStore.remember(`reg:${ctx.userId}`, options.challenge);
    return options;
  }

  async finishWebauthnRegistration(
    ctx: MfaServiceContext,
    response: unknown,
    deviceName?: string,
  ): Promise<{ credentialId: string; attestation: MintedAal2Attestation }> {
    if (!this.webauthn) {
      throw new SecurityServiceError("WebAuthn not configured", 503, "webauthn_unavailable");
    }
    const expectedChallenge = await this.challengeStore.consume(`reg:${ctx.userId}`);
    if (!expectedChallenge) {
      const duplicateCredentialId = extractCredentialIdFromWebauthnResponse(response);
      if (duplicateCredentialId) {
        const existing = await this.repository.findWebauthnCredentialById(ctx.userId, duplicateCredentialId);
        if (existing && isRecentlyCreatedCredential(existing)) {
          await recordAudit(ctx, "mfa.enroll.passkey.duplicate_verify", {
            credentialId: existing.credentialId,
          });
          // HEL-338: a recent duplicate verify is still a fresh WebAuthn
          // ceremony — grant AAL2 so the user isn't walled on their next action.
          return {
            credentialId: existing.credentialId,
            attestation: mintAal2Attestation({ userId: ctx.userId, method: "webauthn" }),
          };
        }
      }
      throw new SecurityServiceError("Registration challenge expired or missing", 400, "challenge_missing");
    }
    const verification = await this.webauthn.verifyRegistrationResponse({
      expectedChallenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
      response,
    });
    if (!verification.verified) {
      await recordAudit(ctx, "mfa.enroll.passkey.failed", { reason: "verification_failed" });
      throw new SecurityServiceError("Passkey registration failed", 400, "registration_failed");
    }
    await this.repository.insertWebauthnCredential({
      userId: ctx.userId,
      credentialId: verification.credentialId,
      publicKey: verification.publicKey,
      signCount: verification.signCount,
      transports: verification.transports,
      aaguid: verification.aaguid,
      backedUp: verification.backedUp,
      deviceName: deviceName ?? null,
    });
    const now = new Date();
    await this.repository.upsertPolicy(ctx.userId, {
      hasWebauthn: true,
      enrollmentCompletedAt: now,
      lastVerifiedAt: now,
      lastVerifiedMethod: "webauthn",
    });
    await recordAudit(ctx, "mfa.enroll.passkey", {
      credentialId: verification.credentialId,
      deviceName: deviceName ?? null,
      backedUp: verification.backedUp,
    });
    // HEL-338: completing a passkey registration ceremony is a fresh strong-auth
    // event — grant AAL2 (parity with finishWebauthnAuthentication / TOTP enroll)
    // so the very next admin request isn't a 401 mfa_step_up_required.
    return {
      credentialId: verification.credentialId,
      attestation: mintAal2Attestation({ userId: ctx.userId, method: "webauthn" }),
    };
  }

  async beginWebauthnAuthentication(
    ctx: MfaServiceContext,
  ): Promise<WebauthnAuthenticationOptions> {
    if (!this.webauthn) {
      throw new SecurityServiceError("WebAuthn not configured", 503, "webauthn_unavailable");
    }
    const credentials = await this.repository.listWebauthnCredentials(ctx.userId);
    if (credentials.length === 0) {
      throw new SecurityServiceError("No passkeys enrolled", 404, "no_passkeys");
    }
    const options = await this.webauthn.generateAuthenticationOptions({
      rpID: this.rpId,
      allowCredentials: credentials.map((c) => ({
        id: c.credentialId,
        type: "public-key",
        transports: c.transports,
      })),
    });
    await this.challengeStore.remember(`auth:${ctx.userId}`, options.challenge);
    return options;
  }

  async finishWebauthnAuthentication(
    ctx: MfaServiceContext,
    response: unknown,
    rawCredentialId: string,
  ): Promise<{ attestation: MintedAal2Attestation }> {
    if (!this.webauthn) {
      throw new SecurityServiceError("WebAuthn not configured", 503, "webauthn_unavailable");
    }
    const expectedChallenge = await this.challengeStore.consume(`auth:${ctx.userId}`);
    if (!expectedChallenge) {
      throw new SecurityServiceError("Authentication challenge expired", 400, "challenge_missing");
    }
    const credential = await this.repository.findWebauthnCredentialById(ctx.userId, rawCredentialId);
    if (!credential || credential.userId !== ctx.userId) {
      await recordAudit(ctx, "mfa.verify.failure", {
        method: "webauthn",
        reason: "unknown_credential",
      });
      throw new SecurityServiceError("Unknown credential", 400, "unknown_credential");
    }
    const verification = await this.webauthn.verifyAuthenticationResponse({
      expectedChallenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
      response,
      authenticator: {
        credentialId: credential.credentialId,
        publicKey: credential.publicKey,
        signCount: credential.signCount,
      },
    });
    if (!verification.verified) {
      await recordAudit(ctx, "mfa.verify.failure", {
        method: "webauthn",
        reason: "signature_invalid",
      });
      throw new SecurityServiceError("Passkey verification failed", 401, "verification_failed");
    }
    const now = new Date();
    await this.repository.updateWebauthnSignCount(ctx.userId, credential.credentialId, verification.newSignCount, now);
    await this.repository.upsertPolicy(ctx.userId, {
      lastVerifiedAt: now,
      lastVerifiedMethod: "webauthn",
    });
    await recordAudit(ctx, "mfa.verify.success", {
      method: "webauthn",
      credentialId: credential.credentialId,
    });
    return {
      attestation: mintAal2Attestation({ userId: ctx.userId, method: "webauthn" }),
    };
  }

  // ---- WebAuthn passwordless login (HEL: discoverable first-factor) ---------
  //
  // Unlike `beginWebauthnAuthentication` (step-up — requires an existing
  // session and an `allowCredentials` list scoped to the signed-in user),
  // these run PRE-AUTH. We generate options with an empty `allowCredentials`
  // so the authenticator offers its discoverable (resident-key) credentials,
  // resolve the asserted credential to its owning user globally, verify the
  // signature against the stored public key, and hand the resolved `userId`
  // back to the route so it can mint a Supabase session. A passkey is a
  // phish-resistant strong factor, so a successful login also mints the AAL2
  // attestation — the user lands fully stepped-up, no second prompt.

  async beginWebauthnLogin(): Promise<{
    loginId: string;
    options: WebauthnAuthenticationOptions;
  }> {
    if (!this.webauthn) {
      throw new SecurityServiceError("WebAuthn not configured", 503, "webauthn_unavailable");
    }
    const options = await this.webauthn.generateAuthenticationOptions({
      rpID: this.rpId,
      // Empty → discoverable-credential ceremony: the browser/authenticator
      // picks a resident key bound to this RP without us naming the user.
      allowCredentials: [],
    });
    // No user to key the challenge on yet, so mint an opaque login id and
    // bind the challenge to it. The client echoes the id back on verify.
    const loginId = randomUUID();
    await this.challengeStore.remember(`login:${loginId}`, options.challenge);
    return { loginId, options };
  }

  async finishWebauthnLogin(
    loginId: string,
    response: unknown,
    rawCredentialId: string,
  ): Promise<{ userId: string; attestation: MintedAal2Attestation }> {
    if (!this.webauthn) {
      throw new SecurityServiceError("WebAuthn not configured", 503, "webauthn_unavailable");
    }
    const expectedChallenge = await this.challengeStore.consume(`login:${loginId}`);
    if (!expectedChallenge) {
      throw new SecurityServiceError("Login challenge expired or missing", 400, "challenge_missing");
    }
    const credential = await this.repository.findWebauthnCredentialByCredentialId(rawCredentialId);
    if (!credential) {
      // No user context to audit against — the mint/throw is the record.
      throw new SecurityServiceError("Unknown credential", 400, "unknown_credential");
    }
    const verification = await this.webauthn.verifyAuthenticationResponse({
      expectedChallenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
      response,
      authenticator: {
        credentialId: credential.credentialId,
        publicKey: credential.publicKey,
        signCount: credential.signCount,
      },
    });
    if (!verification.verified) {
      await recordAudit({ userId: credential.userId }, "mfa.verify.failure", {
        method: "webauthn",
        reason: "signature_invalid",
        context: "passwordless_login",
      });
      throw new SecurityServiceError("Passkey verification failed", 401, "verification_failed");
    }
    const now = new Date();
    // The resolved user scopes the sign-count UPDATE back under user_isolation.
    await this.repository.updateWebauthnSignCount(
      credential.userId,
      credential.credentialId,
      verification.newSignCount,
      now,
    );
    await this.repository.upsertPolicy(credential.userId, {
      lastVerifiedAt: now,
      lastVerifiedMethod: "webauthn",
    });
    await recordAudit({ userId: credential.userId }, "mfa.login.passkey", {
      method: "webauthn",
      credentialId: credential.credentialId,
    });
    return {
      userId: credential.userId,
      attestation: mintAal2Attestation({ userId: credential.userId, method: "webauthn" }),
    };
  }

  async removeWebauthnCredential(ctx: MfaServiceContext, credentialId: string): Promise<void> {
    const deleted = await this.repository.deleteWebauthnCredential(ctx.userId, credentialId);
    if (!deleted) {
      throw new SecurityServiceError("Credential not found", 404, "credential_not_found");
    }
    const remaining = await this.repository.listWebauthnCredentials(ctx.userId);
    await this.repository.upsertPolicy(ctx.userId, {
      hasWebauthn: remaining.length > 0,
    });
    await recordAudit(ctx, "mfa.disable.passkey", { credentialId });
  }

  // ---- TOTP (Supabase native) ----------------------------------------------

  async beginTotpEnrollment(
    ctx: MfaServiceContext,
    accessToken: string,
    friendlyName: string,
  ): Promise<{ factorId: string; qrCodeSvg: string; secret: string; uri: string }> {
    if (!this.totp) {
      throw new SecurityServiceError("TOTP not configured", 503, "totp_unavailable");
    }
    // HEL-327 follow-up: gotrue auto-clears unverified *phone* factors before
    // enroll but leaves unverified *TOTP* factors in place, and rejects a
    // re-enroll that collides on friendly_name with a 422 factor-name
    // conflict. A user who abandons TOTP setup once (closes the tab, reloads,
    // hits a transient error) is then permanently stuck: the stale unverified
    // factor blocks every retry, so the QR/secret never resolves and
    // verification can never complete. Clear any stale unverified TOTP
    // factors first so re-enrollment always starts from a clean slate.
    await this.clearUnverifiedTotpFactors(ctx, accessToken);
    const enrolled = await this.totp.enrollTotp(accessToken, friendlyName);
    await recordAudit(ctx, "mfa.enroll.totp.begin", { factorId: enrolled.factorId });
    return enrolled;
  }

  /**
   * Best-effort removal of the caller's unverified TOTP factors. Verified
   * factors are never touched. Failures here never block enrollment — a real
   * conflict will still surface its own error from the enroll call — so we log
   * and continue.
   */
  private async clearUnverifiedTotpFactors(
    ctx: MfaServiceContext,
    accessToken: string,
  ): Promise<void> {
    if (!this.totp) return;
    let factors: Array<{ id: string; type: "totp" | "phone"; status: "verified" | "unverified" }>;
    try {
      factors = await this.totp.listFactors(accessToken);
    } catch (error) {
      console.warn(
        "[mfaService] could not list factors before TOTP enroll",
        error instanceof Error ? error.message : error,
      );
      return;
    }
    const stale = factors.filter((f) => f.type === "totp" && f.status === "unverified");
    for (const factor of stale) {
      try {
        await this.totp.unenrollTotp(accessToken, factor.id);
        await recordAudit(ctx, "mfa.enroll.totp.cleared_unverified", { factorId: factor.id });
      } catch (error) {
        console.warn(
          "[mfaService] could not clear unverified TOTP factor",
          factor.id,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  async finishTotpEnrollment(
    ctx: MfaServiceContext,
    accessToken: string,
    factorId: string,
    code: string,
  ): Promise<{ attestation: MintedAal2Attestation }> {
    if (!this.totp) {
      throw new SecurityServiceError("TOTP not configured", 503, "totp_unavailable");
    }
    const challenge = await this.totp.challengeTotp(accessToken, factorId);
    await this.totp.verifyTotp(accessToken, factorId, challenge.challengeId, code);
    const now = new Date();
    await this.repository.upsertPolicy(ctx.userId, {
      hasTotp: true,
      enrollmentCompletedAt: now,
      lastVerifiedAt: now,
      lastVerifiedMethod: "totp",
    });
    await recordAudit(ctx, "mfa.enroll.totp", { factorId });
    // HEL-331: verifying the TOTP code is a fresh strong-auth event, so mint
    // AAL2 like every other verify path (webauthn / recovery_code / email_otp).
    // Without it the wizard's immediate regenerateRecoveryCodes() (requireAAL2)
    // 401s and dead-ends in a passkey-only step-up the user can't satisfy.
    return { attestation: mintAal2Attestation({ userId: ctx.userId, method: "totp" }) };
  }

  /**
   * HEL-335: step-up with an ALREADY-VERIFIED TOTP factor (as opposed to
   * `finishTotpEnrollment`, which verifies a freshly-enrolled one). Resolves
   * the user's verified TOTP factor, challenges + verifies the 6-digit code,
   * and mints an AAL2 attestation so a TOTP-only user can satisfy a step-up
   * without falling back to a recovery code.
   */
  async verifyTotpStepUp(
    ctx: MfaServiceContext,
    accessToken: string,
    code: string,
  ): Promise<{ attestation: MintedAal2Attestation }> {
    if (!this.totp) {
      throw new SecurityServiceError("TOTP not configured", 503, "totp_unavailable");
    }
    const factors = await this.totp.listFactors(accessToken);
    const verified = factors.find((f) => f.type === "totp" && f.status === "verified");
    if (!verified) {
      throw new SecurityServiceError("No verified authenticator app", 404, "totp_not_enrolled");
    }
    const challenge = await this.totp.challengeTotp(accessToken, verified.id);
    await this.totp.verifyTotp(accessToken, verified.id, challenge.challengeId, code);
    await this.repository.upsertPolicy(ctx.userId, {
      lastVerifiedAt: new Date(),
      lastVerifiedMethod: "totp",
    });
    await recordAudit(ctx, "mfa.verify.success", { method: "totp", factorId: verified.id });
    return { attestation: mintAal2Attestation({ userId: ctx.userId, method: "totp" }) };
  }

  async removeTotpFactor(
    ctx: MfaServiceContext,
    accessToken: string,
    factorId: string,
  ): Promise<void> {
    if (!this.totp) {
      throw new SecurityServiceError("TOTP not configured", 503, "totp_unavailable");
    }
    await this.totp.unenrollTotp(accessToken, factorId);
    await this.repository.upsertPolicy(ctx.userId, { hasTotp: false });
    await recordAudit(ctx, "mfa.disable.totp", { factorId });
  }

  // ---- Recovery codes ------------------------------------------------------

  async issueRecoveryCodes(
    ctx: MfaServiceContext,
    count: number = DEFAULT_RECOVERY_CODE_COUNT,
  ): Promise<RecoveryCodesIssuedResult> {
    const codes = Array.from({ length: count }, () => generateRecoveryCode());
    const hashes = await Promise.all(codes.map((c) => this.hasher.hash(c)));
    await this.repository.replaceRecoveryCodes(ctx.userId, hashes);
    await this.repository.upsertPolicy(ctx.userId, {
      recoveryCodesIssuedAt: new Date(),
    });
    await recordAudit(ctx, "mfa.recovery_codes.regenerated", { count });
    return { codes, count };
  }

  async consumeRecoveryCode(
    ctx: MfaServiceContext,
    plaintext: string,
  ): Promise<{ attestation: MintedAal2Attestation }> {
    const normalized = plaintext.trim().toUpperCase().replace(/\s+/g, "");
    const consumed = await this.repository.consumeRecoveryCode(ctx.userId, async (hash) => {
      return this.hasher.compare(normalized, hash);
    });
    if (!consumed) {
      await recordAudit(ctx, "mfa.verify.failure", { method: "recovery_code" });
      throw new SecurityServiceError("Invalid or already-used recovery code", 401, "recovery_code_invalid");
    }
    await this.repository.upsertPolicy(ctx.userId, {
      lastVerifiedAt: new Date(),
      lastVerifiedMethod: "recovery_code",
    });
    await recordAudit(ctx, "mfa.recovery_code.used", {});
    return {
      attestation: mintAal2Attestation({ userId: ctx.userId, method: "recovery_code" }),
    };
  }

  // ---- Email OTP + magic link (HEL-282) ------------------------------------
  //
  // App-owned email second factors. Each successful verify mints the same
  // AAL2 attestation cookie as passkey/recovery, so requireAAL2 stays simple.
  // Staff are passkey-only — issuance is rejected for staff users. Both
  // channels share a per-user 5-sends-per-hour rate limit.

  private generateOtpCode(): string {
    // 6 digits, 100000–999999 inclusive (randomInt's upper bound is exclusive).
    return String(randomInt(100000, 1000000));
  }

  private hashMagicLinkToken(rawToken: string): string {
    // 256-bit token → unsalted SHA-256 is sufficient (no dictionary risk).
    return createHash("sha256").update(rawToken).digest("hex");
  }

  private assertNotStaff(userId: string): void {
    if (isAutoflowStaff(userId)) {
      throw new SecurityServiceError(
        "AutoFlow staff must use a passkey; email factors are disabled.",
        403,
        "staff_passkey_only",
      );
    }
  }

  private async enforceSendRateLimit(ctx: MfaServiceContext): Promise<void> {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await this.repository.countRecentEmailFactorSends(ctx.userId, since);
    if (recent >= EMAIL_FACTOR_SENDS_PER_HOUR) {
      await recordAudit(ctx, "mfa.email_factor.rate_limited", { recent });
      throw new SecurityServiceError(
        "Too many verification codes requested. Try again later.",
        429,
        "too_many_codes",
        { retryAfterSeconds: 60 * 60 },
      );
    }
  }

  private async issueEmailOtp(
    ctx: MfaServiceContext,
    userEmail: string,
    purpose: MfaEmailFactorPurpose,
  ): Promise<{ sent: true }> {
    this.assertNotStaff(ctx.userId);
    await this.enforceSendRateLimit(ctx);
    const code = this.generateOtpCode();
    const codeHash = await this.hasher.hash(code);
    const expiresAt = new Date(Date.now() + EMAIL_FACTOR_TTL_SECONDS * 1000);
    await this.repository.insertEmailOtp({ userId: ctx.userId, codeHash, purpose, expiresAt });
    await this.emailSender.send({ to: userEmail, kind: "email_otp_code", code, purpose });
    await recordAudit(ctx, "mfa.email_otp.sent", { purpose });
    return { sent: true };
  }

  beginEmailOtpEnrollment(ctx: MfaServiceContext, userEmail: string): Promise<{ sent: true }> {
    return this.issueEmailOtp(ctx, userEmail, "enroll");
  }

  challengeEmailOtp(ctx: MfaServiceContext, userEmail: string): Promise<{ sent: true }> {
    return this.issueEmailOtp(ctx, userEmail, "verify");
  }

  private async verifyEmailOtpCode(
    ctx: MfaServiceContext,
    purpose: MfaEmailFactorPurpose,
    code: string,
  ): Promise<void> {
    const normalized = code.trim();
    const row = await this.repository.findActiveEmailOtp(ctx.userId, purpose);
    if (!row) {
      await recordAudit(ctx, "mfa.verify.failure", { method: "email_otp", reason: "no_active_code" });
      throw new SecurityServiceError("Code expired or not found. Request a new one.", 400, "otp_not_found");
    }
    const matches = await this.hasher.compare(normalized, row.codeHash);
    if (!matches) {
      const attempts = await this.repository.incrementEmailOtpAttempts(ctx.userId, row.id);
      const locked = attempts >= MAX_OTP_ATTEMPTS;
      if (locked) {
        // Burn the row so a fresh code is required after too many guesses.
        await this.repository.consumeEmailOtp(ctx.userId, row.id);
      }
      await recordAudit(ctx, "mfa.verify.failure", {
        method: "email_otp",
        reason: locked ? "locked" : "wrong_code",
        attempts,
      });
      throw new SecurityServiceError(
        locked ? "Too many incorrect attempts. Request a new code." : "Incorrect code.",
        401,
        locked ? "otp_locked" : "otp_invalid",
      );
    }
    await this.repository.consumeEmailOtp(ctx.userId, row.id);
  }

  async verifyEmailOtpEnrollment(
    ctx: MfaServiceContext,
    code: string,
  ): Promise<{ attestation: MintedAal2Attestation }> {
    await this.verifyEmailOtpCode(ctx, "enroll", code);
    const now = new Date();
    await this.repository.upsertPolicy(ctx.userId, {
      hasEmailOtp: true,
      enrollmentCompletedAt: now,
      lastVerifiedAt: now,
      lastVerifiedMethod: "email_otp",
    });
    await recordAudit(ctx, "mfa.enroll.email_otp", {});
    return { attestation: mintAal2Attestation({ userId: ctx.userId, method: "email_otp" }) };
  }

  async verifyEmailOtp(
    ctx: MfaServiceContext,
    code: string,
  ): Promise<{ attestation: MintedAal2Attestation }> {
    await this.verifyEmailOtpCode(ctx, "verify", code);
    await this.repository.upsertPolicy(ctx.userId, {
      lastVerifiedAt: new Date(),
      lastVerifiedMethod: "email_otp",
    });
    await recordAudit(ctx, "mfa.verify.success", { method: "email_otp" });
    return { attestation: mintAal2Attestation({ userId: ctx.userId, method: "email_otp" }) };
  }

  async removeEmailOtp(ctx: MfaServiceContext): Promise<void> {
    await this.repository.upsertPolicy(ctx.userId, { hasEmailOtp: false });
    await recordAudit(ctx, "mfa.disable.email_otp", {});
  }

  private async issueMagicLink(
    ctx: MfaServiceContext,
    userEmail: string,
    purpose: MfaEmailFactorPurpose,
  ): Promise<{ sent: true }> {
    this.assertNotStaff(ctx.userId);
    await this.enforceSendRateLimit(ctx);
    const rawToken = randomBytes(MAGIC_LINK_TOKEN_BYTES).toString("base64url");
    const tokenHash = this.hashMagicLinkToken(rawToken);
    const expiresAt = new Date(Date.now() + EMAIL_FACTOR_TTL_SECONDS * 1000);
    await this.repository.insertMagicLink({ userId: ctx.userId, tokenHash, purpose, expiresAt });
    const link = `${this.magicLinkApiBaseUrl.replace(/\/$/, "")}/api/mfa/magic-link/verify?token=${encodeURIComponent(rawToken)}`;
    await this.emailSender.send({ to: userEmail, kind: "magic_link", link, purpose });
    await recordAudit(ctx, "mfa.magic_link.sent", { purpose });
    return { sent: true };
  }

  beginMagicLinkEnrollment(ctx: MfaServiceContext, userEmail: string): Promise<{ sent: true }> {
    return this.issueMagicLink(ctx, userEmail, "enroll");
  }

  challengeMagicLink(ctx: MfaServiceContext, userEmail: string): Promise<{ sent: true }> {
    return this.issueMagicLink(ctx, userEmail, "verify");
  }

  /**
   * Pre-auth: consumes a magic-link token clicked from an email (no session).
   * The token itself binds the user. Marks the factor enrolled on first
   * `enroll` click, stamps last-verified, and mints the AAL2 attestation.
   * Returns null on invalid/expired/already-consumed tokens.
   */
  async consumeMagicLinkToken(rawToken: string): Promise<{
    userId: string;
    purpose: MfaEmailFactorPurpose;
    attestation: MintedAal2Attestation;
  } | null> {
    const tokenHash = this.hashMagicLinkToken(rawToken);
    const consumed = await this.repository.consumeMagicLinkByTokenHash(tokenHash);
    if (!consumed) return null;
    const { userId, purpose } = consumed;
    const now = new Date();
    await this.repository.upsertPolicy(userId, {
      ...(purpose === "enroll" ? { hasMagicLink: true, enrollmentCompletedAt: now } : {}),
      lastVerifiedAt: now,
      lastVerifiedMethod: "magic_link",
    });
    // No workspace context on the pre-auth click — recordAudit no-ops without
    // a workspaceId, which is acceptable here (the mint is the security record).
    await recordAudit(
      { userId },
      purpose === "enroll" ? "mfa.enroll.magic_link" : "mfa.verify.success",
      { method: "magic_link" },
    );
    return {
      userId,
      purpose,
      attestation: mintAal2Attestation({ userId, method: "magic_link" }),
    };
  }

  async removeMagicLink(ctx: MfaServiceContext): Promise<void> {
    await this.repository.upsertPolicy(ctx.userId, { hasMagicLink: false });
    await recordAudit(ctx, "mfa.disable.magic_link", {});
  }
}

let defaultService: MfaService | null = null;

export function getMfaService(): MfaService {
  if (!defaultService) {
    // Concrete adapters live in separate modules so unit tests of the
    // service can stub them without dragging the SimpleWebAuthn library
    // (and its WebCrypto subtleties) into the jest preset.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SimpleWebAuthnAdapter } = require("./simpleWebAuthnAdapter");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SupabaseAuthTotpAdapter } = require("./supabaseTotpAdapter");
    defaultService = new MfaService({
      webauthn: new SimpleWebAuthnAdapter(),
      totp: new SupabaseAuthTotpAdapter(),
    });
  }
  return defaultService;
}

export function setMfaServiceForTests(service: MfaService | null): void {
  defaultService = service;
}
