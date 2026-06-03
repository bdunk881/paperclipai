import {
  DefaultRecoveryCodeHasher,
  MfaService,
  type SupabaseTotpAdapter,
  type WebauthnAdapter,
  type WebauthnAuthenticationOptions,
  type WebauthnRegistrationOptions,
  type WebauthnVerifyAuthenticationResult,
  type WebauthnVerifyRegistrationResult,
} from "./mfaService";
import { InMemoryMfaRepository } from "./mfaRepository";
import { InMemoryMfaChallengeStore } from "./mfaChallengeStore";
import type { MfaEmailMessage, MfaEmailSender } from "./mfaEmailSender";
import { __resetStaffIdsCacheForTests } from "../admin/staffAuth";
import { verifyAal2AttestationCookie } from "../middleware/requireAAL2";

const APP_JWT_SECRET = "test-secret-key-at-least-32-bytes-long-please";

function makeWebauthnStub(overrides: Partial<WebauthnAdapter> = {}): WebauthnAdapter {
  return {
    // HEL-337: these MUST be async — the real @simplewebauthn/server@11
    // functions return Promises. The original synchronous stub is exactly why
    // the "unawaited Promise → undefined challenge" bug slipped past the suite.
    generateRegistrationOptions: async (input) =>
      ({
        challenge: "REG_CHALLENGE",
        rp: { name: input.rpName, id: input.rpID },
        user: { id: input.userID, name: input.userName, displayName: input.userDisplayName },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        timeout: 60000,
        attestation: "none",
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        excludeCredentials: input.excludeCredentials,
      }) as WebauthnRegistrationOptions,
    generateAuthenticationOptions: async (input) =>
      ({
        challenge: "AUTH_CHALLENGE",
        rpId: input.rpID,
        timeout: 60000,
        userVerification: "required",
        allowCredentials: input.allowCredentials,
      }) as WebauthnAuthenticationOptions,
    verifyRegistrationResponse: jest.fn(async () =>
      ({
        verified: true,
        credentialId: "cred-1",
        publicKey: Buffer.from("pubkey"),
        signCount: 0n,
        transports: ["internal"],
        aaguid: null,
        backedUp: true,
      }) as WebauthnVerifyRegistrationResult),
    verifyAuthenticationResponse: jest.fn(async () =>
      ({
        verified: true,
        newSignCount: 1n,
      }) as WebauthnVerifyAuthenticationResult),
    ...overrides,
  };
}

function makeTotpStub(): SupabaseTotpAdapter {
  return {
    enrollTotp: jest.fn(async () => ({
      factorId: "factor-1",
      qrCodeSvg: "<svg/>",
      secret: "SECRET",
      uri: "otpauth://totp/test",
    })),
    challengeTotp: jest.fn(async () => ({ challengeId: "challenge-1" })),
    verifyTotp: jest.fn(async () => undefined),
    unenrollTotp: jest.fn(async () => undefined),
    listFactors: jest.fn(async () => []),
  };
}

describe("MfaService", () => {
  const originalSecret = process.env.APP_JWT_SECRET;
  let repo: InMemoryMfaRepository;

  beforeEach(() => {
    process.env.APP_JWT_SECRET = APP_JWT_SECRET;
    repo = new InMemoryMfaRepository();
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.APP_JWT_SECRET;
    else process.env.APP_JWT_SECRET = originalSecret;
  });

  it("returns an empty policy for a fresh user", async () => {
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp: makeTotpStub() });
    const policy = await service.getPolicy({ userId: "u-1" });
    expect(policy.hasWebauthn).toBe(false);
    expect(policy.hasTotp).toBe(false);
    expect(policy.hasAnyFactor).toBe(false);
    expect(policy.webauthnDevices).toHaveLength(0);
    // HEL-280: with no provider passed, signInMethod is "unknown" and
    // requiresAppMfa defaults to true (most-conservative).
    expect(policy.signInMethod).toBe("unknown");
    expect(policy.requiresAppMfa).toBe(true);
  });

  // HEL-399 -----------------------------------------------------------------
  it("removeTotpFactor unenrolls the real factor UUID, not the passed string", async () => {
    const REAL_ID = "11111111-2222-4333-8444-555555555555";
    const totp = makeTotpStub();
    jest.mocked(totp.listFactors).mockResolvedValue([
      { id: REAL_ID, type: "totp", status: "verified" },
    ]);
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp });

    // The admin UI passes the literal "totp"; the service must resolve the real
    // Supabase factor UUID via listFactors before deleting (else Supabase 404s
    // and the factor survives while local policy flips — split-brain).
    await service.removeTotpFactor({ userId: "u-1" }, "access-token", "totp");

    expect(totp.listFactors).toHaveBeenCalledWith("access-token");
    expect(totp.unenrollTotp).toHaveBeenCalledWith("access-token", REAL_ID);
    expect(totp.unenrollTotp).not.toHaveBeenCalledWith("access-token", "totp");
  });

  it("removeTotpFactor does not call unenroll when no TOTP factor exists upstream", async () => {
    const totp = makeTotpStub(); // listFactors returns [] by default
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp });

    await service.removeTotpFactor({ userId: "u-1" }, "access-token", "totp");

    expect(totp.unenrollTotp).not.toHaveBeenCalled();
  });

  // HEL-280 ----------------------------------------------------------------

  it("derives signInMethod and requires app MFA for password sign-ins", async () => {
    const flagChecker = jest.fn().mockResolvedValue(false);
    const service = new MfaService({
      repository: repo,
      webauthn: makeWebauthnStub(),
      totp: makeTotpStub(),
      workspaceFlagChecker: flagChecker,
    });
    const policy = await service.getPolicy(
      { userId: "u-1", workspaceId: "ws-1" },
      { provider: "email", amr: [{ method: "password", timestamp: 1 }] },
    );
    expect(policy.signInMethod).toBe("password");
    expect(policy.requiresAppMfa).toBe(true);
    // No flag check for non-OAuth sign-ins — they always require app MFA.
    expect(flagChecker).not.toHaveBeenCalled();
  });

  it("skips app MFA enforcement for OAuth users by default", async () => {
    const flagChecker = jest.fn().mockResolvedValue(false);
    const service = new MfaService({
      repository: repo,
      webauthn: makeWebauthnStub(),
      totp: makeTotpStub(),
      workspaceFlagChecker: flagChecker,
    });
    const policy = await service.getPolicy(
      { userId: "u-1", workspaceId: "ws-1" },
      { provider: "google", amr: [{ method: "oauth", timestamp: 1 }] },
    );
    expect(policy.signInMethod).toBe("oauth_google");
    expect(policy.requiresAppMfa).toBe(false);
    expect(flagChecker).toHaveBeenCalledWith("ws-1", "u-1", "require_app_mfa_for_oauth_users");
  });

  it("re-requires app MFA for OAuth users when the workspace override flag is on", async () => {
    const flagChecker = jest.fn().mockResolvedValue(true);
    const service = new MfaService({
      repository: repo,
      webauthn: makeWebauthnStub(),
      totp: makeTotpStub(),
      workspaceFlagChecker: flagChecker,
    });
    const policy = await service.getPolicy(
      { userId: "u-1", workspaceId: "ws-ent" },
      { provider: "github", amr: [{ method: "oauth", timestamp: 1 }] },
    );
    expect(policy.signInMethod).toBe("oauth_github");
    expect(policy.requiresAppMfa).toBe(true);
  });

  // HEL-305: the bug we just fixed — a user who signed up via email
  // and later linked Google still has `app_metadata.provider="email"`
  // forever, but the current session's amr says oauth. The policy
  // must treat them as OAuth based on the per-session signal.
  it("treats a session with amr=oauth as OAuth even when provider is the signup email IdP (HEL-305)", async () => {
    const flagChecker = jest.fn().mockResolvedValue(false);
    const service = new MfaService({
      repository: repo,
      webauthn: makeWebauthnStub(),
      totp: makeTotpStub(),
      workspaceFlagChecker: flagChecker,
    });
    const policy = await service.getPolicy(
      { userId: "u-1", workspaceId: "ws-1" },
      { provider: "email", amr: [{ method: "oauth", timestamp: 1 }] },
    );
    expect(policy.signInMethod).toBe("oauth_google");
    expect(policy.requiresAppMfa).toBe(false);
  });

  it("enrolls a webauthn credential end-to-end", async () => {
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp: makeTotpStub() });
    const ctx = { userId: "u-1" };
    const options = await service.beginWebauthnRegistration(ctx, "alice@example.com");
    expect(options.challenge).toBe("REG_CHALLENGE");

    const result = await service.finishWebauthnRegistration(ctx, { mockResponse: true }, "MacBook");
    expect(result.credentialId).toBe("cred-1");
    // HEL-338: passkey registration must mint an AAL2 attestation so the user
    // isn't immediately walled with 401 mfa_step_up_required on their next call.
    const verified = verifyAal2AttestationCookie(result.attestation.token, "u-1");
    expect(verified.valid).toBe(true);
    expect(verified.claims?.method).toBe("webauthn");

    const policy = await service.getPolicy(ctx);
    expect(policy.hasWebauthn).toBe(true);
    expect(policy.webauthnDevices).toHaveLength(1);
    expect(policy.webauthnDevices[0].deviceName).toBe("MacBook");
    expect(policy.lastVerifiedMethod).toBe("webauthn");
  });

  it("translates a missing-user FK violation on enroll into a 401 session_user_missing (HEL-396)", async () => {
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp: makeTotpStub() });
    const ctx = { userId: "u-deleted" };
    await service.beginWebauthnRegistration(ctx, "ghost@example.com");

    // Simulate HEL-395's FK rejecting an insert whose user_id no longer exists
    // in auth.users (the stale-session-for-a-deleted-account case). `pg`
    // surfaces this as a DatabaseError with code 23503 + the constraint name.
    const fkError = Object.assign(
      new Error('insert ... violates foreign key constraint "mfa_webauthn_credentials_user_id_fkey"'),
      { code: "23503", constraint: "mfa_webauthn_credentials_user_id_fkey" },
    );
    jest.spyOn(repo, "insertWebauthnCredential").mockRejectedValueOnce(fkError);

    await expect(
      service.finishWebauthnRegistration(ctx, { mockResponse: true }, "MacBook"),
    ).rejects.toMatchObject({ statusCode: 401, code: "session_user_missing" });
  });

  it("propagates a non-FK insert error from enroll unchanged (HEL-396)", async () => {
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp: makeTotpStub() });
    const ctx = { userId: "u-1" };
    await service.beginWebauthnRegistration(ctx, "alice@example.com");

    const boom = new Error("db is on fire");
    jest.spyOn(repo, "insertWebauthnCredential").mockRejectedValueOnce(boom);

    await expect(
      service.finishWebauthnRegistration(ctx, { mockResponse: true }, "MacBook"),
    ).rejects.toBe(boom);
  });

  it("rejects finish without a prior begin (no challenge stored)", async () => {
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp: makeTotpStub() });
    await expect(
      service.finishWebauthnRegistration({ userId: "u-1" }, {}),
    ).rejects.toThrow(/challenge/i);
  });

  it("persists the REAL challenge to the store on begin (HEL-337 regression)", async () => {
    // Guards the un-awaited-Promise bug: if generateRegistrationOptions isn't
    // awaited, `options.challenge` is undefined and the store holds garbage,
    // so consume() returns falsy at finish → "challenge expired or missing".
    // A shared store lets us assert the begin side wrote the actual challenge.
    const store = new InMemoryMfaChallengeStore();
    const service = new MfaService({
      repository: repo,
      webauthn: makeWebauthnStub(),
      totp: makeTotpStub(),
      challengeStore: store,
    });
    const ctx = { userId: "u-1" };

    const options = await service.beginWebauthnRegistration(ctx, "alice@example.com");
    // The browser-facing options carry a real challenge...
    expect(options.challenge).toBe("REG_CHALLENGE");
    // ...and CRUCIALLY the same value must be what we stored (not undefined).
    const stored = await store.consume(`reg:${ctx.userId}`);
    expect(stored).toBe("REG_CHALLENGE");
  });

  it("persists the REAL challenge on authentication begin (HEL-337 regression)", async () => {
    const store = new InMemoryMfaChallengeStore();
    const service = new MfaService({
      repository: repo,
      webauthn: makeWebauthnStub(),
      totp: makeTotpStub(),
      challengeStore: store,
    });
    const ctx = { userId: "u-1" };
    // Need an enrolled credential so beginWebauthnAuthentication doesn't 404.
    await service.beginWebauthnRegistration(ctx, "alice@example.com");
    await service.finishWebauthnRegistration(ctx, { mockResponse: true }, "MacBook");

    await service.beginWebauthnAuthentication(ctx);
    const stored = await store.consume(`auth:${ctx.userId}`);
    expect(stored).toBe("AUTH_CHALLENGE");
  });

  // Passwordless first-factor login (discoverable credential) -----------------

  it("logs in passwordless: resolves the credential to its user and mints AAL2", async () => {
    const store = new InMemoryMfaChallengeStore();
    const webauthn = makeWebauthnStub();
    const service = new MfaService({
      repository: repo,
      webauthn,
      totp: makeTotpStub(),
      challengeStore: store,
    });
    // Enroll a passkey for u-1 so there's a discoverable credential to resolve.
    const ctx = { userId: "u-1" };
    await service.beginWebauthnRegistration(ctx, "alice@example.com");
    await service.finishWebauthnRegistration(ctx, { id: "cred-1" }, "MacBook");

    const { loginId, options } = await service.beginWebauthnLogin();
    // Discoverable ceremony → no allowCredentials list leaks the user set.
    expect(options.allowCredentials).toEqual([]);
    expect(await store.consume(`login:${loginId}`)).toBe("AUTH_CHALLENGE");

    // (consume above drained it; start a fresh login for the finish path)
    const second = await service.beginWebauthnLogin();
    const result = await service.finishWebauthnLogin(second.loginId, { id: "cred-1" }, "cred-1");
    expect(result.userId).toBe("u-1");
    expect(result.attestation.token).toBeTruthy();
    const verified = verifyAal2AttestationCookie(result.attestation.token, "u-1");
    expect(verified.valid).toBe(true);
  });

  it("rejects passwordless login for an unknown credential", async () => {
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp: makeTotpStub() });
    const { loginId } = await service.beginWebauthnLogin();
    await expect(
      service.finishWebauthnLogin(loginId, { id: "nope" }, "nope"),
    ).rejects.toThrow(/unknown credential/i);
  });

  it("rejects passwordless login when the challenge is missing or expired", async () => {
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp: makeTotpStub() });
    await expect(
      service.finishWebauthnLogin("never-issued", { id: "cred-1" }, "cred-1"),
    ).rejects.toThrow(/challenge/i);
  });

  it("rejects passwordless login when the signature does not verify", async () => {
    const webauthn = makeWebauthnStub({
      verifyAuthenticationResponse: jest.fn(async () => ({ verified: false, newSignCount: 0n })),
    });
    const service = new MfaService({ repository: repo, webauthn, totp: makeTotpStub() });
    const ctx = { userId: "u-1" };
    await service.beginWebauthnRegistration(ctx, "alice@example.com");
    await service.finishWebauthnRegistration(ctx, { id: "cred-1" }, "MacBook");

    const { loginId } = await service.beginWebauthnLogin();
    await expect(
      service.finishWebauthnLogin(loginId, { id: "cred-1" }, "cred-1"),
    ).rejects.toThrow(/verification failed/i);
  });

  it("treats a retried registration verify as success once the credential already exists", async () => {
    const webauthn = makeWebauthnStub();
    const service = new MfaService({ repository: repo, webauthn, totp: makeTotpStub() });
    const ctx = { userId: "u-1" };
    const response = { id: "cred-1", rawId: "cred-1" };

    await service.beginWebauthnRegistration(ctx, "alice@example.com");
    // HEL-338: both the first verify and the recent-duplicate retry now also
    // return an AAL2 attestation, so assert credentialId + a present attestation
    // rather than a strict-equal on the whole object.
    const first = await service.finishWebauthnRegistration(ctx, response, "MacBook");
    expect(first.credentialId).toBe("cred-1");
    expect(first.attestation.token).toBeTruthy();

    const retry = await service.finishWebauthnRegistration(ctx, response, "MacBook");
    expect(retry.credentialId).toBe("cred-1");
    expect(retry.attestation.token).toBeTruthy();

    expect(webauthn.verifyRegistrationResponse).toHaveBeenCalledTimes(1);
  });

  it("does not accept a missing registration challenge for another user's credential", async () => {
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp: makeTotpStub() });
    await service.beginWebauthnRegistration({ userId: "u-1" }, "alice@example.com");
    await service.finishWebauthnRegistration({ userId: "u-1" }, { id: "cred-1" }, "MacBook");

    await expect(
      service.finishWebauthnRegistration({ userId: "u-2" }, { id: "cred-1" }, "MacBook"),
    ).rejects.toThrow(/challenge/i);
  });

  // HEL-303: regression — when the challenge store is shared (Redis in
  // prod), a different MfaService instance can complete the ceremony
  // that another instance started. This simulates a Fly machine
  // restart between begin and finish: same store, fresh service.
  it("completes registration across service instances when the challenge store is shared", async () => {
    const sharedStore = new InMemoryMfaChallengeStore();
    const ctx = { userId: "u-shared" };

    const beginService = new MfaService({
      repository: repo,
      webauthn: makeWebauthnStub(),
      totp: makeTotpStub(),
      challengeStore: sharedStore,
    });
    const options = await beginService.beginWebauthnRegistration(ctx, "alice@example.com");
    expect(options.challenge).toBe("REG_CHALLENGE");

    // New service instance — simulates the verify request hitting a
    // different Fly machine (or the same machine after a restart).
    const finishService = new MfaService({
      repository: repo,
      webauthn: makeWebauthnStub(),
      totp: makeTotpStub(),
      challengeStore: sharedStore,
    });
    const result = await finishService.finishWebauthnRegistration(ctx, { mockResponse: true }, "Other machine");
    expect(result.credentialId).toBe("cred-1");
  });

  it("a per-instance challenge store fails the cross-instance ceremony (proves the regression test is meaningful)", async () => {
    const ctx = { userId: "u-isolated" };
    const beginService = new MfaService({
      repository: repo,
      webauthn: makeWebauthnStub(),
      totp: makeTotpStub(),
      challengeStore: new InMemoryMfaChallengeStore(),
    });
    await beginService.beginWebauthnRegistration(ctx, "alice@example.com");

    const finishService = new MfaService({
      repository: repo,
      webauthn: makeWebauthnStub(),
      totp: makeTotpStub(),
      challengeStore: new InMemoryMfaChallengeStore(),
    });
    await expect(
      finishService.finishWebauthnRegistration(ctx, { mockResponse: true }, "Other machine"),
    ).rejects.toThrow(/challenge/i);
  });

  it("rejects finish when verifyRegistrationResponse returns verified=false", async () => {
    const adapter = makeWebauthnStub({
      verifyRegistrationResponse: jest.fn(async () => ({
        verified: false,
        credentialId: "",
        publicKey: Buffer.alloc(0),
        signCount: 0n,
        transports: [],
        aaguid: null,
        backedUp: false,
      })),
    });
    const service = new MfaService({ repository: repo, webauthn: adapter, totp: makeTotpStub() });
    const ctx = { userId: "u-1" };
    await service.beginWebauthnRegistration(ctx, "alice@example.com");
    await expect(service.finishWebauthnRegistration(ctx, {})).rejects.toThrow(/registration/i);
    const policy = await service.getPolicy(ctx);
    expect(policy.hasWebauthn).toBe(false);
  });

  it("authenticates a passkey and mints an AAL2 attestation", async () => {
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp: makeTotpStub() });
    const ctx = { userId: "u-1" };
    await service.beginWebauthnRegistration(ctx, "alice@example.com");
    await service.finishWebauthnRegistration(ctx, {}, "Laptop");

    await service.beginWebauthnAuthentication(ctx);
    const verification = await service.finishWebauthnAuthentication(ctx, {}, "cred-1");
    expect(verification.attestation.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(verification.attestation.maxAgeSeconds).toBeGreaterThan(0);

    const refreshed = await service.getPolicy(ctx);
    expect(refreshed.lastVerifiedMethod).toBe("webauthn");
  });

  it("rejects authentication for a credential the user does not own", async () => {
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp: makeTotpStub() });
    const ctx = { userId: "u-1" };
    await service.beginWebauthnRegistration(ctx, "alice@example.com");
    await service.finishWebauthnRegistration(ctx, {}, "Laptop");
    await service.beginWebauthnAuthentication(ctx);
    await expect(
      service.finishWebauthnAuthentication({ userId: "u-2" }, {}, "cred-1"),
    ).rejects.toThrow(/challenge|credential/i);
  });

  it("removes a passkey and clears hasWebauthn when the last one is gone", async () => {
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp: makeTotpStub() });
    const ctx = { userId: "u-1" };
    await service.beginWebauthnRegistration(ctx, "alice@example.com");
    await service.finishWebauthnRegistration(ctx, {}, "Laptop");
    await service.removeWebauthnCredential(ctx, "cred-1");
    const policy = await service.getPolicy(ctx);
    expect(policy.hasWebauthn).toBe(false);
  });

  it("issues recovery codes, returns plaintext, and can consume them once", async () => {
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp: makeTotpStub() });
    const ctx = { userId: "u-1" };
    const issued = await service.issueRecoveryCodes(ctx, 5);
    expect(issued.codes).toHaveLength(5);
    expect(new Set(issued.codes).size).toBe(5);

    const verification = await service.consumeRecoveryCode(ctx, issued.codes[0]);
    expect(verification.attestation.token).toBeTruthy();

    // Code can't be reused
    await expect(service.consumeRecoveryCode(ctx, issued.codes[0])).rejects.toThrow(/invalid/i);

    // A different code still works
    const second = await service.consumeRecoveryCode(ctx, issued.codes[1]);
    expect(second.attestation.token).toBeTruthy();
  });

  it("regenerate invalidates all prior recovery codes", async () => {
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp: makeTotpStub() });
    const ctx = { userId: "u-1" };
    const first = await service.issueRecoveryCodes(ctx, 3);
    await service.issueRecoveryCodes(ctx, 3);
    // old code should now fail
    await expect(service.consumeRecoveryCode(ctx, first.codes[0])).rejects.toThrow(/invalid/i);
  });

  it("rejects an invalid recovery code", async () => {
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp: makeTotpStub() });
    const ctx = { userId: "u-1" };
    await service.issueRecoveryCodes(ctx, 3);
    await expect(service.consumeRecoveryCode(ctx, "BOGUS-CODE-1234")).rejects.toThrow();
  });

  it("resets the password out-of-band with a valid recovery code (lost-device path)", async () => {
    const passwordResetter = jest.fn().mockResolvedValue(undefined);
    const service = new MfaService({
      repository: repo,
      webauthn: makeWebauthnStub(),
      totp: makeTotpStub(),
      passwordResetter,
    });
    const ctx = { userId: "u-1" };
    const issued = await service.issueRecoveryCodes(ctx, 3);

    await service.resetPasswordWithRecoveryCode(ctx, issued.codes[0], "brand-new-pass-123");
    expect(passwordResetter).toHaveBeenCalledWith("u-1", "brand-new-pass-123");

    // The recovery code is single-use: a second attempt with it fails.
    await expect(
      service.resetPasswordWithRecoveryCode(ctx, issued.codes[0], "another-pass-123"),
    ).rejects.toThrow(/invalid/i);
  });

  it("rejects a weak password before consuming the recovery code", async () => {
    const passwordResetter = jest.fn().mockResolvedValue(undefined);
    const service = new MfaService({
      repository: repo,
      webauthn: makeWebauthnStub(),
      totp: makeTotpStub(),
      passwordResetter,
    });
    const ctx = { userId: "u-1" };
    const issued = await service.issueRecoveryCodes(ctx, 3);

    await expect(
      service.resetPasswordWithRecoveryCode(ctx, issued.codes[0], "short"),
    ).rejects.toThrow(/at least 8/i);
    expect(passwordResetter).not.toHaveBeenCalled();

    // The code wasn't burned by the failed attempt — it still works.
    await service.resetPasswordWithRecoveryCode(ctx, issued.codes[0], "brand-new-pass-123");
    expect(passwordResetter).toHaveBeenCalledWith("u-1", "brand-new-pass-123");
  });

  it("does not set a password when the recovery code is invalid", async () => {
    const passwordResetter = jest.fn().mockResolvedValue(undefined);
    const service = new MfaService({
      repository: repo,
      webauthn: makeWebauthnStub(),
      totp: makeTotpStub(),
      passwordResetter,
    });
    const ctx = { userId: "u-1" };
    await service.issueRecoveryCodes(ctx, 3);

    await expect(
      service.resetPasswordWithRecoveryCode(ctx, "BOGUS-CODE-1234", "brand-new-pass-123"),
    ).rejects.toThrow();
    expect(passwordResetter).not.toHaveBeenCalled();
  });

  it("setPasswordForCurrentUser sets the password via the resetter (attestation-gated path)", async () => {
    const passwordResetter = jest.fn().mockResolvedValue(undefined);
    const service = new MfaService({
      repository: repo,
      webauthn: makeWebauthnStub(),
      totp: makeTotpStub(),
      passwordResetter,
    });
    const ctx = { userId: "u-1" };

    await service.setPasswordForCurrentUser(ctx, "brand-new-pass-123");
    expect(passwordResetter).toHaveBeenCalledWith("u-1", "brand-new-pass-123");
  });

  it("setPasswordForCurrentUser rejects a weak password without calling the resetter", async () => {
    const passwordResetter = jest.fn().mockResolvedValue(undefined);
    const service = new MfaService({
      repository: repo,
      webauthn: makeWebauthnStub(),
      totp: makeTotpStub(),
      passwordResetter,
    });

    await expect(
      service.setPasswordForCurrentUser({ userId: "u-1" }, "short"),
    ).rejects.toThrow(/at least 8/i);
    expect(passwordResetter).not.toHaveBeenCalled();
  });

  it("sends a password-changed notice after a recovery-code reset (HEL-383)", async () => {
    const passwordResetter = jest.fn().mockResolvedValue(undefined);
    const sender = makeEmailSender();
    const service = new MfaService({
      repository: repo,
      webauthn: makeWebauthnStub(),
      totp: makeTotpStub(),
      passwordResetter,
      emailSender: sender,
    });
    const ctx = { userId: "u-1", email: "user@example.com" };
    const issued = await service.issueRecoveryCodes(ctx, 3);

    await service.resetPasswordWithRecoveryCode(ctx, issued.codes[0], "brand-new-pass-123");

    const notice = sender.sent.find((m) => m.kind === "password_changed");
    expect(notice?.to).toBe("user@example.com");
    expect(notice?.method).toBe("a recovery code");
  });

  it("skips the password-changed notice when no email is on the context (HEL-383)", async () => {
    const passwordResetter = jest.fn().mockResolvedValue(undefined);
    const sender = makeEmailSender();
    const service = new MfaService({
      repository: repo,
      webauthn: makeWebauthnStub(),
      totp: makeTotpStub(),
      passwordResetter,
      emailSender: sender,
    });
    const ctx = { userId: "u-1" };
    const issued = await service.issueRecoveryCodes(ctx, 3);

    await service.resetPasswordWithRecoveryCode(ctx, issued.codes[0], "brand-new-pass-123");
    expect(sender.sent.some((m) => m.kind === "password_changed")).toBe(false);
  });

  it("delegates TOTP enrollment to the Supabase adapter", async () => {
    const totp = makeTotpStub();
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp });
    const ctx = { userId: "u-1" };
    const result = await service.beginTotpEnrollment(ctx, "token", "iPhone");
    expect(result.factorId).toBe("factor-1");
    expect(totp.enrollTotp).toHaveBeenCalledWith("token", "iPhone");

    const { attestation } = await service.finishTotpEnrollment(ctx, "token", "factor-1", "123456");
    expect(totp.verifyTotp).toHaveBeenCalled();
    // HEL-331: TOTP verify must mint an AAL2 attestation (parity with the other
    // factors) so the wizard's follow-up recovery-code issuance isn't blocked
    // into a passkey-only step-up.
    const verified = verifyAal2AttestationCookie(attestation.token, "u-1");
    expect(verified.valid).toBe(true);
    expect(verified.claims?.method).toBe("totp");
    const policy = await service.getPolicy(ctx);
    expect(policy.hasTotp).toBe(true);
  });

  it("verifies an existing TOTP factor for step-up and mints an AAL2 attestation (HEL-335)", async () => {
    const totp = makeTotpStub();
    (totp.listFactors as jest.Mock).mockResolvedValueOnce([
      { id: "verified-totp", type: "totp", status: "verified" },
    ]);
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp });
    const ctx = { userId: "u-1" };

    const { attestation } = await service.verifyTotpStepUp(ctx, "token", "123456");

    expect(totp.challengeTotp).toHaveBeenCalledWith("token", "verified-totp");
    expect(totp.verifyTotp).toHaveBeenCalledWith("token", "verified-totp", "challenge-1", "123456");
    const verified = verifyAal2AttestationCookie(attestation.token, "u-1");
    expect(verified.valid).toBe(true);
    expect(verified.claims?.method).toBe("totp");
  });

  it("rejects TOTP step-up when no verified factor exists (HEL-335)", async () => {
    const totp = makeTotpStub();
    (totp.listFactors as jest.Mock).mockResolvedValueOnce([
      { id: "unverified", type: "totp", status: "unverified" },
    ]);
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp });
    const ctx = { userId: "u-1" };

    await expect(service.verifyTotpStepUp(ctx, "token", "123456")).rejects.toThrow();
    expect(totp.verifyTotp).not.toHaveBeenCalled();
  });

  it("clears stale unverified TOTP factors before re-enrolling (HEL-327 follow-up)", async () => {
    const totp = makeTotpStub();
    (totp.listFactors as jest.Mock).mockResolvedValueOnce([
      { id: "stale-unverified", type: "totp", status: "unverified" },
      { id: "verified-keep", type: "totp", status: "verified" },
    ]);
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp });
    const ctx = { userId: "u-1" };

    await service.beginTotpEnrollment(ctx, "token", "AutoFlow Admin authenticator");

    expect(totp.listFactors).toHaveBeenCalledWith("token");
    // Only the unverified factor is removed; the verified one is preserved.
    expect(totp.unenrollTotp).toHaveBeenCalledWith("token", "stale-unverified");
    expect(totp.unenrollTotp).not.toHaveBeenCalledWith("token", "verified-keep");
    // Enrollment still proceeds after the cleanup.
    expect(totp.enrollTotp).toHaveBeenCalledWith("token", "AutoFlow Admin authenticator");
  });

  it("still enrolls TOTP when listing existing factors fails", async () => {
    const totp = makeTotpStub();
    (totp.listFactors as jest.Mock).mockRejectedValueOnce(new Error("supabase down"));
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp });
    const ctx = { userId: "u-1" };

    const result = await service.beginTotpEnrollment(ctx, "token", "iPhone");

    expect(result.factorId).toBe("factor-1");
    expect(totp.unenrollTotp).not.toHaveBeenCalled();
    expect(totp.enrollTotp).toHaveBeenCalledWith("token", "iPhone");
  });
});

describe("DefaultRecoveryCodeHasher", () => {
  it("hashes and verifies a code", async () => {
    const hasher = new DefaultRecoveryCodeHasher();
    const hash = await hasher.hash("ABCD-1234-EFGH-5678");
    expect(await hasher.compare("ABCD-1234-EFGH-5678", hash)).toBe(true);
    expect(await hasher.compare("WRONG", hash)).toBe(false);
  });

  it("rejects malformed hashes safely", async () => {
    const hasher = new DefaultRecoveryCodeHasher();
    expect(await hasher.compare("ABC", "not-a-valid-hash")).toBe(false);
    expect(await hasher.compare("ABC", "")).toBe(false);
  });

  it("produces different hashes for the same code (salted)", async () => {
    const hasher = new DefaultRecoveryCodeHasher();
    const a = await hasher.hash("SAME");
    const b = await hasher.hash("SAME");
    expect(a).not.toBe(b);
    expect(await hasher.compare("SAME", a)).toBe(true);
    expect(await hasher.compare("SAME", b)).toBe(true);
  });
});

// HEL-282: email-OTP + magic-link second factors ---------------------------

interface CapturingSender extends MfaEmailSender {
  sent: MfaEmailMessage[];
}

function makeEmailSender(): CapturingSender {
  const sent: MfaEmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

function tokenFromLink(link: string): string {
  return new URL(link).searchParams.get("token") ?? "";
}

describe("MfaService — email OTP + magic link (HEL-282)", () => {
  const APP_JWT_SECRET = "test-secret-key-at-least-32-bytes-long-please";
  const originalSecret = process.env.APP_JWT_SECRET;
  const originalStaff = process.env.AUTOFLOW_STAFF_USER_IDS;
  let repo: InMemoryMfaRepository;
  let email: CapturingSender;

  beforeEach(() => {
    process.env.APP_JWT_SECRET = APP_JWT_SECRET;
    delete process.env.AUTOFLOW_STAFF_USER_IDS;
    __resetStaffIdsCacheForTests();
    repo = new InMemoryMfaRepository();
    email = makeEmailSender();
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.APP_JWT_SECRET;
    else process.env.APP_JWT_SECRET = originalSecret;
    if (originalStaff === undefined) delete process.env.AUTOFLOW_STAFF_USER_IDS;
    else process.env.AUTOFLOW_STAFF_USER_IDS = originalStaff;
    __resetStaffIdsCacheForTests();
  });

  function makeService(): MfaService {
    return new MfaService({
      repository: repo,
      emailSender: email,
      magicLinkApiBaseUrl: "https://api.test",
    });
  }

  it("enrolls email OTP and mints an email_otp attestation", async () => {
    const service = makeService();
    const ctx = { userId: "u-otp" };

    const begin = await service.beginEmailOtpEnrollment(ctx, "user@example.com");
    expect(begin).toEqual({ sent: true });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].kind).toBe("email_otp_code");
    const code = email.sent[0].code!;
    expect(code).toMatch(/^\d{6}$/);

    const { attestation } = await service.verifyEmailOtpEnrollment(ctx, code);
    const verified = verifyAal2AttestationCookie(attestation.token, "u-otp");
    expect(verified.valid).toBe(true);
    expect(verified.claims?.method).toBe("email_otp");

    const policy = await service.getPolicy(ctx);
    expect(policy.hasEmailOtp).toBe(true);
    expect(policy.hasAnyFactor).toBe(true);
    expect(policy.lastVerifiedMethod).toBe("email_otp");
  });

  it("rejects an expired email OTP", async () => {
    const service = makeService();
    const ctx = { userId: "u-exp" };
    const hasher = new DefaultRecoveryCodeHasher();
    await repo.insertEmailOtp({
      userId: ctx.userId,
      codeHash: await hasher.hash("123456"),
      purpose: "enroll",
      expiresAt: new Date(Date.now() - 1000), // already expired
    });
    await expect(service.verifyEmailOtpEnrollment(ctx, "123456")).rejects.toMatchObject({
      statusCode: 400,
      code: "otp_not_found",
    });
  });

  it("increments attempts on wrong code then locks after 3", async () => {
    const service = makeService();
    const ctx = { userId: "u-lock" };
    await service.beginEmailOtpEnrollment(ctx, "user@example.com");

    await expect(service.verifyEmailOtpEnrollment(ctx, "000001")).rejects.toMatchObject({
      code: "otp_invalid",
    });
    await expect(service.verifyEmailOtpEnrollment(ctx, "000002")).rejects.toMatchObject({
      code: "otp_invalid",
    });
    // Third wrong guess locks (consumes) the row.
    await expect(service.verifyEmailOtpEnrollment(ctx, "000003")).rejects.toMatchObject({
      code: "otp_locked",
    });
    // Even the correct code now fails — the row is consumed.
    const code = email.sent[0].code!;
    await expect(service.verifyEmailOtpEnrollment(ctx, code)).rejects.toMatchObject({
      code: "otp_not_found",
    });
  });

  it("rate-limits to 5 sends per hour (6th returns 429 too_many_codes)", async () => {
    const service = makeService();
    const ctx = { userId: "u-rate" };
    for (let i = 0; i < 5; i += 1) {
      await service.beginEmailOtpEnrollment(ctx, "user@example.com");
    }
    await expect(service.beginEmailOtpEnrollment(ctx, "user@example.com")).rejects.toMatchObject({
      statusCode: 429,
      code: "too_many_codes",
    });
  });

  it("counts email-OTP and magic-link sends together toward the rate limit", async () => {
    const service = makeService();
    const ctx = { userId: "u-mixed" };
    await service.beginEmailOtpEnrollment(ctx, "user@example.com"); // 1
    await service.challengeMagicLink(ctx, "user@example.com"); // 2
    await service.beginEmailOtpEnrollment(ctx, "user@example.com"); // 3
    await service.challengeMagicLink(ctx, "user@example.com"); // 4
    await service.beginEmailOtpEnrollment(ctx, "user@example.com"); // 5
    await expect(service.challengeMagicLink(ctx, "user@example.com")).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it("rejects email factors for staff users with 403", async () => {
    process.env.AUTOFLOW_STAFF_USER_IDS = "staff-1,staff-2";
    __resetStaffIdsCacheForTests();
    const service = makeService();

    await expect(
      service.beginEmailOtpEnrollment({ userId: "staff-1" }, "staff@autoflow.com"),
    ).rejects.toMatchObject({ statusCode: 403, code: "staff_passkey_only" });
    await expect(
      service.beginMagicLinkEnrollment({ userId: "staff-2" }, "staff@autoflow.com"),
    ).rejects.toMatchObject({ statusCode: 403, code: "staff_passkey_only" });

    // A non-staff user is unaffected.
    await expect(
      service.beginEmailOtpEnrollment({ userId: "normal-user" }, "user@example.com"),
    ).resolves.toEqual({ sent: true });
  });

  it("enrolls magic-link on first token consume and enforces one-time use", async () => {
    const service = makeService();
    const ctx = { userId: "u-magic" };

    await service.beginMagicLinkEnrollment(ctx, "user@example.com");
    expect(email.sent[0].kind).toBe("magic_link");
    const token = tokenFromLink(email.sent[0].link!);
    expect(token.length).toBeGreaterThan(20);

    const first = await service.consumeMagicLinkToken(token);
    expect(first).not.toBeNull();
    expect(first!.userId).toBe("u-magic");
    expect(first!.purpose).toBe("enroll");
    const verified = verifyAal2AttestationCookie(first!.attestation.token, "u-magic");
    expect(verified.valid).toBe(true);
    expect(verified.claims?.method).toBe("magic_link");

    const policy = await service.getPolicy(ctx);
    expect(policy.hasMagicLink).toBe(true);

    // Second consume of the same token fails (one-time use).
    expect(await service.consumeMagicLinkToken(token)).toBeNull();
  });

  it("rejects an unknown / malformed magic-link token", async () => {
    const service = makeService();
    expect(await service.consumeMagicLinkToken("not-a-real-token")).toBeNull();
  });
});
