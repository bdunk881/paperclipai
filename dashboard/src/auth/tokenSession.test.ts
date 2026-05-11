import { describe, expect, it } from "vitest";
import { sessionFromAccessToken } from "./tokenSession";

function makeToken(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${encoded}.signature`;
}

describe("sessionFromAccessToken", () => {
  it("derives a preview session from JWT claims", () => {
    const payload = btoa(
      JSON.stringify({
        sub: "preview-user-1",
        email: "preview@example.com",
        name: "Preview User",
        tid: "tenant-1",
        exp: 1_900_000_000,
      })
    );
    const token = `header.${payload}.signature`;

    expect(sessionFromAccessToken(token, "preview")).toEqual({
      accessToken: token,
      expiresAt: 1_900_000_000_000,
      authProvider: "preview",
      user: {
        id: "preview-user-1",
        email: "preview@example.com",
        name: "Preview User",
        tenantId: "tenant-1",
      },
    });
  });

  it("throws when the token cannot be decoded", () => {
    expect(() => sessionFromAccessToken("invalid", "preview")).toThrow(/could not be decoded/i);
  });

  it("throws when the token payload has no exp claim", () => {
    const token = makeToken({ sub: "u1", email: "a@b.com" });
    expect(() => sessionFromAccessToken(token, "preview")).toThrow(/missing an expiration/i);
  });

  it("uses preferred_username as email fallback when email is absent", () => {
    const token = makeToken({ sub: "u1", preferred_username: "pref@b.com", exp: 1_900_000_000 });
    const result = sessionFromAccessToken(token, "preview");
    expect(result.user.email).toBe("pref@b.com");
  });

  it("falls back to unknown@autoflow.local when no email claim exists", () => {
    const token = makeToken({ sub: "u1", exp: 1_900_000_000 });
    const result = sessionFromAccessToken(token, "preview");
    expect(result.user.email).toBe("unknown@autoflow.local");
  });

  it("uses given_name as name fallback when name is absent", () => {
    const token = makeToken({ sub: "u1", email: "a@b.com", given_name: "Given", exp: 1_900_000_000 });
    const result = sessionFromAccessToken(token, "preview");
    expect(result.user.name).toBe("Given");
  });

  it("falls back to email as name when no name claim exists", () => {
    const token = makeToken({ sub: "u1", email: "a@b.com", exp: 1_900_000_000 });
    const result = sessionFromAccessToken(token, "preview");
    expect(result.user.name).toBe("a@b.com");
  });

  it("uses oid as user id fallback when sub is absent", () => {
    const token = makeToken({ oid: "oid-123", email: "a@b.com", exp: 1_900_000_000 });
    const result = sessionFromAccessToken(token, "preview");
    expect(result.user.id).toBe("oid-123");
  });

  it("falls back to email as user id when both sub and oid are absent", () => {
    const token = makeToken({ email: "fallback@b.com", exp: 1_900_000_000 });
    const result = sessionFromAccessToken(token, "preview");
    expect(result.user.id).toBe("fallback@b.com");
  });

  it("accepts array email claim and uses the first string entry", () => {
    const token = makeToken({ sub: "u1", email: ["first@b.com", "second@b.com"], exp: 1_900_000_000 });
    const result = sessionFromAccessToken(token, "preview");
    expect(result.user.email).toBe("first@b.com");
  });

  it("returns undefined tenantId when tid claim is absent", () => {
    const token = makeToken({ sub: "u1", email: "a@b.com", exp: 1_900_000_000 });
    const result = sessionFromAccessToken(token, "preview");
    expect(result.user.tenantId).toBeUndefined();
  });
});
