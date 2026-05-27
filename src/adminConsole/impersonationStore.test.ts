import {
  InvalidImpersonationTokenError,
  isImpersonationConfigured,
  mintImpersonationToken,
  verifyImpersonationToken,
} from "./impersonationStore";

describe("impersonationStore", () => {
  const prevSecret = process.env.IMPERSONATION_TOKEN_SECRET;
  beforeEach(() => {
    process.env.IMPERSONATION_TOKEN_SECRET = "a-secret-thats-at-least-32-characters!!";
  });
  afterAll(() => {
    if (prevSecret !== undefined) {
      process.env.IMPERSONATION_TOKEN_SECRET = prevSecret;
    } else {
      delete process.env.IMPERSONATION_TOKEN_SECRET;
    }
  });

  it("reports configured only when a long-enough secret is set", () => {
    expect(isImpersonationConfigured()).toBe(true);
    delete process.env.IMPERSONATION_TOKEN_SECRET;
    expect(isImpersonationConfigured()).toBe(false);
    process.env.IMPERSONATION_TOKEN_SECRET = "short";
    expect(isImpersonationConfigured()).toBe(false);
  });

  it("round-trips a valid token", () => {
    const { token, payload } = mintImpersonationToken({
      impersonatorUserId: "admin-1",
      impersonatedUserId: "user-1",
      sessionId: "11111111-1111-4111-8111-111111111111",
    });
    const verified = verifyImpersonationToken(token);
    expect(verified.impersonator_user_id).toBe("admin-1");
    expect(verified.impersonated_user_id).toBe("user-1");
    expect(verified.session_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(verified.mode).toBe("read_only");
    expect(verified.exp).toBe(payload.exp);
    expect(verified.jti).toBe(payload.jti);
  });

  it("rejects an expired token", () => {
    const { token } = mintImpersonationToken({
      impersonatorUserId: "admin-1",
      impersonatedUserId: "user-1",
      sessionId: "11111111-1111-4111-8111-111111111111",
      ttlSeconds: -10,
    });
    expect(() => verifyImpersonationToken(token)).toThrow(InvalidImpersonationTokenError);
  });

  it("rejects a tampered signature", () => {
    const { token } = mintImpersonationToken({
      impersonatorUserId: "admin-1",
      impersonatedUserId: "user-1",
      sessionId: "11111111-1111-4111-8111-111111111111",
    });
    const tampered = token.slice(0, -2) + (token.endsWith("A") ? "B" : "A");
    expect(() => verifyImpersonationToken(tampered)).toThrow(/signature/);
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = mintImpersonationToken({
      impersonatorUserId: "admin-1",
      impersonatedUserId: "user-1",
      sessionId: "11111111-1111-4111-8111-111111111111",
    });
    process.env.IMPERSONATION_TOKEN_SECRET = "a-different-secret-also-32-chars-long!!";
    expect(() => verifyImpersonationToken(token)).toThrow(/signature/);
  });

  it("rejects garbage", () => {
    expect(() => verifyImpersonationToken("not.a.token")).toThrow();
    expect(() => verifyImpersonationToken("only-one-part")).toThrow();
  });
});
