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

const APP_JWT_SECRET = "test-secret-key-at-least-32-bytes-long-please";

function makeWebauthnStub(overrides: Partial<WebauthnAdapter> = {}): WebauthnAdapter {
  return {
    generateRegistrationOptions: (input) =>
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
    generateAuthenticationOptions: (input) =>
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
      { provider: "email" },
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
      { provider: "google" },
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
      { provider: "github" },
    );
    expect(policy.signInMethod).toBe("oauth_github");
    expect(policy.requiresAppMfa).toBe(true);
  });

  it("enrolls a webauthn credential end-to-end", async () => {
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp: makeTotpStub() });
    const ctx = { userId: "u-1" };
    const options = await service.beginWebauthnRegistration(ctx, "alice@example.com");
    expect(options.challenge).toBe("REG_CHALLENGE");

    const result = await service.finishWebauthnRegistration(ctx, { mockResponse: true }, "MacBook");
    expect(result.credentialId).toBe("cred-1");

    const policy = await service.getPolicy(ctx);
    expect(policy.hasWebauthn).toBe(true);
    expect(policy.webauthnDevices).toHaveLength(1);
    expect(policy.webauthnDevices[0].deviceName).toBe("MacBook");
  });

  it("rejects finish without a prior begin (no challenge stored)", async () => {
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp: makeTotpStub() });
    await expect(
      service.finishWebauthnRegistration({ userId: "u-1" }, {}),
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

  it("delegates TOTP enrollment to the Supabase adapter", async () => {
    const totp = makeTotpStub();
    const service = new MfaService({ repository: repo, webauthn: makeWebauthnStub(), totp });
    const ctx = { userId: "u-1" };
    const result = await service.beginTotpEnrollment(ctx, "token", "iPhone");
    expect(result.factorId).toBe("factor-1");
    expect(totp.enrollTotp).toHaveBeenCalledWith("token", "iPhone");

    await service.finishTotpEnrollment(ctx, "token", "factor-1", "123456");
    expect(totp.verifyTotp).toHaveBeenCalled();
    const policy = await service.getPolicy(ctx);
    expect(policy.hasTotp).toBe(true);
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
