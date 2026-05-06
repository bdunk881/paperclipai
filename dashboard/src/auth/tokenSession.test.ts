import { describe, expect, it } from "vitest";
import { sessionFromAccessToken } from "./tokenSession";

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
});
