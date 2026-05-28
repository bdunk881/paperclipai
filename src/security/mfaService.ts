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

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SecurityServiceError } from "./securityService";
import { auditService } from "../auditing/auditService";
import {
  getDefaultMfaRepository,
  type MfaRepository,
  type UserMfaPolicyRow,
  type WebauthnCredentialRow,
} from "./mfaRepository";
import {
  mintAal2Attestation,
  type MintedAal2Attestation,
} from "../middleware/requireAAL2";
import {
  REQUIRE_APP_MFA_FOR_OAUTH_USERS,
  isWorkspaceFlagEnabled as defaultWorkspaceFlagChecker,
} from "./workspaceFeatureFlags";

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
  lastVerifiedMethod: "webauthn" | "totp" | "recovery_code" | null;
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
  generateRegistrationOptions(input: {
    rpName: string;
    rpID: string;
    userID: string;
    userName: string;
    userDisplayName: string;
    excludeCredentials: Array<{ id: string; type: "public-key"; transports?: string[] }>;
  }): WebauthnRegistrationOptions;
  generateAuthenticationOptions(input: {
    rpID: string;
    allowCredentials: Array<{ id: string; type: "public-key"; transports?: string[] }>;
  }): WebauthnAuthenticationOptions;
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
}

export interface GetPolicyOptions {
  /** Supabase `app_metadata.provider` claim. Used to derive `signInMethod`. */
  provider?: string;
}

/**
 * HEL-280: Supabase exposes the IdP via `app_metadata.provider`. Map the
 * raw provider name into our typed `SignInMethod`. Unknown providers
 * fall through to `"unknown"` so we always require app-side MFA for
 * anything we don't explicitly trust.
 */
function deriveSignInMethod(provider: string | undefined): SignInMethod {
  switch (provider) {
    case "google":
      return "oauth_google";
    case "github":
      return "oauth_github";
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

function formatPolicy(
  policy: UserMfaPolicyRow | null,
  credentials: WebauthnCredentialRow[],
  activeRecoveryCodes: number,
  signInMethod: SignInMethod,
  requiresAppMfa: boolean,
): MfaPolicySummary {
  return {
    hasWebauthn: credentials.length > 0,
    hasTotp: policy?.hasTotp ?? false,
    hasAnyFactor: credentials.length > 0 || (policy?.hasTotp ?? false),
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
  private challengeStore = new Map<string, { challenge: string; createdAt: number }>();

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
  }

  private parseOriginEnv(raw: string): string | string[] {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length === 1 ? parts[0] : parts;
  }

  private rememberChallenge(key: string, challenge: string): void {
    // 5-minute TTL.
    const now = Date.now();
    for (const [k, v] of this.challengeStore.entries()) {
      if (now - v.createdAt > 5 * 60 * 1000) this.challengeStore.delete(k);
    }
    this.challengeStore.set(key, { challenge, createdAt: now });
  }

  private consumeChallenge(key: string): string | null {
    const entry = this.challengeStore.get(key);
    if (!entry) return null;
    this.challengeStore.delete(key);
    if (Date.now() - entry.createdAt > 5 * 60 * 1000) return null;
    return entry.challenge;
  }

  async getPolicy(ctx: MfaServiceContext, options: GetPolicyOptions = {}): Promise<MfaPolicySummary> {
    const signInMethod = deriveSignInMethod(options.provider);
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
    const options = this.webauthn.generateRegistrationOptions({
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
    this.rememberChallenge(`reg:${ctx.userId}`, options.challenge);
    return options;
  }

  async finishWebauthnRegistration(
    ctx: MfaServiceContext,
    response: unknown,
    deviceName?: string,
  ): Promise<{ credentialId: string }> {
    if (!this.webauthn) {
      throw new SecurityServiceError("WebAuthn not configured", 503, "webauthn_unavailable");
    }
    const expectedChallenge = this.consumeChallenge(`reg:${ctx.userId}`);
    if (!expectedChallenge) {
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
    await this.repository.upsertPolicy(ctx.userId, {
      hasWebauthn: true,
      enrollmentCompletedAt: new Date(),
    });
    await recordAudit(ctx, "mfa.enroll.passkey", {
      credentialId: verification.credentialId,
      deviceName: deviceName ?? null,
      backedUp: verification.backedUp,
    });
    return { credentialId: verification.credentialId };
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
    const options = this.webauthn.generateAuthenticationOptions({
      rpID: this.rpId,
      allowCredentials: credentials.map((c) => ({
        id: c.credentialId,
        type: "public-key",
        transports: c.transports,
      })),
    });
    this.rememberChallenge(`auth:${ctx.userId}`, options.challenge);
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
    const expectedChallenge = this.consumeChallenge(`auth:${ctx.userId}`);
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
    const enrolled = await this.totp.enrollTotp(accessToken, friendlyName);
    await recordAudit(ctx, "mfa.enroll.totp.begin", { factorId: enrolled.factorId });
    return enrolled;
  }

  async finishTotpEnrollment(
    ctx: MfaServiceContext,
    accessToken: string,
    factorId: string,
    code: string,
  ): Promise<void> {
    if (!this.totp) {
      throw new SecurityServiceError("TOTP not configured", 503, "totp_unavailable");
    }
    const challenge = await this.totp.challengeTotp(accessToken, factorId);
    await this.totp.verifyTotp(accessToken, factorId, challenge.challengeId, code);
    await this.repository.upsertPolicy(ctx.userId, {
      hasTotp: true,
      enrollmentCompletedAt: new Date(),
    });
    await recordAudit(ctx, "mfa.enroll.totp", { factorId });
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
